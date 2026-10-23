# Tasks 076: managed configuration for organizations

Each phase is one small PR. Tasks reference the spec's FRs. Nothing is built yet.

## P0: spec (this PR)

- [x] T001 Research (vendor docs, `read:` table), spec, plan, tasks, samples (`samples/managed/`, `samples/endpoint/`) and JSON schemas validated against the samples; specs-index block; Q1-Q12 for Vikram

## P1: loader, safe mode, locks, Organization page

- [ ] T010 `src/main/policydir.ts`: machine and user folders per OS, `DURBAR_MANAGED_DIR` only with dev hooks, POSIX trust check [FR-002..FR-005]
- [ ] T011 `src/shared/policy.ts`: types, closed validator with JSON-path messages, limits, secret-literal detector, path containment [FR-006, FR-009, FR-013, FR-121, FR-123]
- [ ] T012 `src/main/policystore.ts`: read layers, precedence, safe and key-level states, reload, watcher [FR-007, FR-008, FR-010..FR-012]
- [ ] T013 Lock plumbing: `settings:get` policy view, `refuseIfLocked` in settings IPC, Durbar MCP server ops, remote control, schedules, assistant [FR-014, FR-016, FR-125]
- [ ] T014 Safe mode effects: mode clamp to Read-only, MCP additions and folder MCP off, harness install off, remote control off [FR-011]
- [ ] T015 Renderer: `lockLine`, red and yellow banners, Settings > Organization with Reload and Copy as text [FR-014, FR-015]
- [ ] T016 Tests `test-policy` (validator vs schema with `ajv`, broken fixtures under `scripts/fixtures/policy-bad/`), simulator driver, screenshots [FR-140, FR-141]
- [ ] T017 Docs: README *For organizations* section, `docs/managed-config.md` (folder, schema, sample), website schema copies, changelog fragment, agent-notes if anything is learned

## P2: branding and theme

- [ ] T020 Display name in title, quit dialog, Mac menu labels, notifications, theme words; About *based on Agent Durbar*; `test:about` extended [FR-020, FR-021, FR-023]
- [ ] T021 Icon: PNG header check, window icon, macOS Dock icon [FR-022]
- [ ] T022 Theme lock, managed pack through `checkUserManifest`, `allowUserThemes`, `allowThemeMaker` [FR-090..FR-093]
- [ ] T023 Tests, simulator screenshots, docs

## P3: allowed agent apps

- [ ] T030 Filter `adapters:list` and every starter (New session, assistant, profile AI, theme maker, VS Code continue, schedules) [FR-030]
- [ ] T031 Settings > Agent apps lock lines; `allowInAppInstall` refusal in harness IPC [FR-031, FR-032]
- [ ] T032 Disallowed sessions readable, not resumable [FR-033, FR-008]
- [ ] T033 Tests, simulator, docs

## P4: MCP restrict and complement (local lists)

- [ ] T040 `mcpAllowed` matcher, modes, deny-wins [FR-042]
- [ ] T041 `durbar-mcp-list-v1` reader with the secret rules [FR-040, FR-041]
- [ ] T042 Enforcement in `mcpstore`, spec 069 global add/harmonize, spec 061 folder scan, `startopts` (disabled names per adapter), session switches [FR-043, FR-045]
- [ ] T043 Required servers from the machine layer, locked on [FR-044]
- [ ] T044 Org entries as a catalog source (with issue #539's spec) [FR-040]
- [ ] T045 Tests `test-policy-mcp`, simulator, docs [FR-047]

## P5: MCP endpoints

- [ ] T050 `policyfetch.ts` with limits, redirects, timeouts, ETag cache [FR-046, FR-120]
- [ ] T051 `mcp-registry-v0.1` reader (`GET /v0.1/servers`) [FR-040]
- [ ] T052 Refresh schedule, *last updated* in the catalog, fail-closed in `allowlist` with no copy [FR-046]
- [ ] T053 Tests `test-policy-fetch` (local fake server through injected fetch), docs

## P6: custom LLM per agent app

- [ ] T060 No-prompt checks: Codex `model_providers` override (offline schema), Copilot BYOK variables via the SDK runtime (dummy endpoint), Claude Code gateway and Bedrock/Vertex variable names (docs + local fake gateway); record in agent-notes [FR-100..FR-102, FR-142]
- [ ] T061 `policyEnvFor` per adapter; Copilot `createClient` `env` option [FR-100..FR-102, FR-124]
- [ ] T062 Locked model picker; *price unknown*; sign-in check wording [FR-103..FR-105]
- [ ] T063 Tests `test-policy-env`, simulator, docs

## P7: OpenTelemetry per agent app

- [ ] T070 Constitution amendment for Q4 (if Vikram agrees), via `/speckit-constitution`
- [ ] T071 No-prompt checks: Codex per-thread `[otel]`, Copilot OTel variables (`copilot help`) [FR-082, FR-083, FR-142]
- [ ] T072 Mapping for Claude Code, Codex, Copilot (when confirmed); missing-variable reporting [FR-080..FR-085]
- [ ] T073 Tests, Organization page per-app status, docs

## P8: agent, profile and skill registry

- [ ] T080 Index reader and update decisions [FR-060, FR-063..FR-065]
- [ ] T081 Install, hash check, safe write, bookkeeping, uninstall [FR-061, FR-062, FR-065]
- [ ] T082 Trust step for non-text files and powerful tools; user registries [FR-066]
- [ ] T083 Managed items read-only in the profile editor [FR-067]
- [ ] T084 Settings > Agents and skills UI, update badge and toast
- [ ] T085 Tests `test-registry`, simulator, screenshots, docs

## Proposed additions

Not tasks until Vikram decides (spec, *Proposed additions*, A1-A19).

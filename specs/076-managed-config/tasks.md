# Tasks 076: managed configuration for organizations

Each phase is one small PR. Tasks reference the spec's FRs. Nothing is built yet. Phase order follows the owner's build order
(spec, *Phases*).

## P0: spec (this PR)

- [x] T001 Research (vendor docs, `read:` table), spec, plan, tasks, samples (`samples/managed/`, `samples/endpoint/`) and JSON schemas validated against the samples; specs-index block; Q1-Q12 for Vikram
- [x] T002 Owner answers Q1-Q12 recorded (2026-10-23); Q10 changed to admin token pricing: FR-104 rewritten, FR-106..FR-109, schema and sample updated
- [x] T003 Security review by Paco's agent (17 items) folded in: threat model, FR-002..FR-005, FR-010..FR-017, FR-040..FR-046, FR-060..FR-066, FR-080..FR-086, FR-100a, FR-120..FR-121a; schemas tightened; `samples/hostile/` fixtures with `probes.json`; R1-R8 for the owners
- [x] T005 R1-R8 answered by Vikram (2026-10-23, recommended defaults) and recorded under Clarifications
- [x] T004 A1-A19 accepted by Vikram (2026-10-23): section N (FR-150..FR-197), phases P2-P26, schema keys and sample values

## P1: loader, closed mode, locks, Organization page, dev variables

- [ ] T010 `src/main/policydir.ts`: machine folder per OS (Windows Known Folder via `koffi`, never `%ProgramFiles%`), user folder, `DURBAR_MANAGED_DIR` only unpackaged [FR-002..FR-004]
- [ ] T011 Trust check: POSIX owner/mode on every file and parent after `realpath`; Windows write probe; elevated-run note [FR-005]
- [ ] T012 `src/main/devhooks.ts`: ignore `DURBAR_DEV` and every `DURBAR_*` in a packaged build when a machine policy is present, unless `allowDevHooks`; machine folder resolved before `devEnv`; DevTools refused under a policy [FR-004, FR-197]
- [ ] T013 Test: dev variables under a policy (packaged + policy: `DURBAR_DEV=1 DURBAR_DRIVER=x` gives `{}`; with `allowDevHooks: true` they apply and the warning shows; no policy: unchanged; `DURBAR_MANAGED_DIR` never in packaged) [FR-004]
- [ ] T014 `src/shared/policy.ts`: closed validator with JSON-path messages that never echo values, limits, path containment, `redact.ts` secret scan, env allow-list binding; vendor parts delegated to `src/adapters/<app>Policy.ts` [FR-006, FR-009, FR-013, FR-121, FR-121a, FR-123]
- [ ] T015 `src/main/policystore.ts`: layers, precedence, narrow-only user layer (allowed keys, widening refused), reload, watcher [FR-003, FR-007, FR-008]
- [ ] T016 Closed mode (`canAct()` guard in every starter and sender, specs 041/054/048/044 included) and key-level strict states [FR-010..FR-012]
- [ ] T017 Lock plumbing: `settings:get` policy view, `refuseIfLocked` in every writer; no key can widen a mode [FR-014, FR-016, FR-017, FR-125]
- [ ] T018 Hostile-fixture test: run `ajv` and `validatePolicy` on every row of `samples/hostile/probes.json` and assert the expected verdict; assert `httpsUrl`/`text` are identical across the three schemas [FR-013, FR-140]
- [ ] T019 Strict-state test: for each area of FR-012, the strict state is at least as strict as every valid value in the samples; closed mode refuses start, resume, send, schedule and remote/MCP-server-driven starts [FR-010..FR-012, SC-003]
- [ ] T020 Renderer: `lockLine` (organization vs user config wording), red and yellow banners, Settings > Organization with Reload and Copy as text [FR-014, FR-015]
- [ ] T021 Simulator driver, screenshots at 1440x900 and 1280x800 [FR-141]
- [ ] T022 Docs: README *For organizations*, `docs/managed-config.md` (folder, schema, sample, threat model), website schema copies, changelog fragment, agent-notes

## P2: A1 permission mode lock

- [ ] T030 `maxMode`, `defaultMode`, `allowAll` in the mode menu, folder restore and every starter; grants under a Read-only cap [FR-150..FR-152]
- [ ] T031 Tests (clamping, refusal in main, user layer can only lower), simulator, docs

## P3: A2 proxy, CA and mTLS

- [ ] T035 `session.setProxy` for the window and fetch partition; `HTTPS_PROXY`/`NO_PROXY` per app; CA bundle (private key refused) as `NODE_EXTRA_CA_CERTS`; `CLAUDE_CODE_CERT_STORE`; mTLS paths and passphrase env [FR-155..FR-157]
- [ ] T036 Tests (env mapping per app, PEM checks), docs; read each app's proxy/CA docs and record in agent-notes

## P4: A5 feature switches

- [ ] T040 `featureEnabled(name)` guard in main and window for every listed feature; running links/servers stop on reload [FR-158]
- [ ] T041 Review rule for future specs (FR-159) in `AGENTS.md`'s review list; tests, docs

## P5: A4 installers

- [ ] T045 Read electron-builder MSI/NSIS per-machine/pkg/deb/rpm docs; choose the Windows format; record in the spec [FR-160]
- [ ] T046 Targets in `package.json` `build`; silent flags; managed folder laid down by the installer with admin-only permissions [FR-160, FR-161]
- [ ] T047 Air-gapped docs; CI package smoke for the new targets [FR-162]

## P6: A3 signing and notarization

- [ ] T050 `needs-owner-approval` Buy the Windows and Apple signing certificates/accounts only after Vikram's explicit OK at purchase time (spec 014) [FR-164]
- [ ] T051 Sign and notarize in the release workflow (spec 014); Linux signatures and SHA-256 sums [FR-164, FR-165]

## P7: branding and theme

- [ ] T060 Display name in title, quit dialog, Mac menu labels, notifications, theme words; About *based on Agent Durbar*; `test:about` extended [FR-020, FR-021, FR-023]
- [ ] T061 Icon: PNG header check, window icon, macOS Dock icon [FR-022]
- [ ] T062 Theme lock, managed pack through `checkUserManifest`, `allowUserThemes`, `allowThemeMaker` [FR-090..FR-093]
- [ ] T063 Tests, simulator screenshots, docs

## P8: allowed agent apps

- [ ] T070 Filter `adapters:list` and every starter (New session, assistant, profile AI, theme maker, VS Code continue, schedules, specs 041/054) [FR-030, FR-016]
- [ ] T071 Settings > Agent apps lock lines; `allowInAppInstall` refusal in harness IPC [FR-031, FR-032]
- [ ] T072 Disallowed sessions readable, not resumable [FR-033, FR-008]
- [ ] T073 Tests, simulator, docs

## P9: MCP restrict and complement (local lists)

- [ ] T080 Matcher by definition (allow by org entry definition, deny by name, launcher-aware command match), modes, deny-wins [FR-042]
- [ ] T081 `durbar-mcp-list-v1` reader: stdio, env references and `required` only from machine-folder files; secret rules [FR-040, FR-041, FR-044]
- [ ] T082 Enforcement in `mcpstore`, spec 069, spec 061, `startopts`, session switches; trust prompt for every stdio server from any source [FR-043, FR-045]
- [ ] T083 Org entries as a catalog source (with issue #539's spec) [FR-040]
- [ ] T084 Tests `test-policy-mcp` (including the `mcp-remote-*` hostile fixtures as URL-sourced), simulator, docs [FR-047]

## P10: MCP endpoints

- [ ] T090 `policyfetch.ts`: partition without cookies or ambient auth, address refusals per hop, limits, timeouts, ETag cache re-validated on use [FR-046, FR-120]
- [ ] T091 `mcp-registry-v0.1` reader: `remotes` only, id mapping, page and byte caps [FR-040]
- [ ] T092 Refresh schedule, *last updated* and *Unsigned list* in the catalog, fail closed in `allowlist` with no copy [FR-046]
- [ ] T093 Tests `test-policy-fetch` (local fake server and fake resolver through injection: loopback, link-local, metadata, private without and with `allowPrivateHosts`, redirect to http, oversize, slow), docs

## P11: custom LLM per agent app, pricing and token caps

- [ ] T100 No-prompt checks: Codex `model_providers` override (offline schema), Copilot BYOK variables via the SDK runtime (dummy endpoint), Claude Code gateway and Bedrock/Vertex variable names (docs + local fake gateway); record in agent-notes [FR-100..FR-102, FR-142]
- [ ] T101 `src/adapters/<app>Policy.ts` mapping; Copilot `createClient` `env` option; vendor credential stripping; missing token blocks the start; model chip with host and first-run notice [FR-100..FR-102, FR-100a, FR-124]
- [ ] T102 Locked model picker; sign-in check wording [FR-103, FR-105]
- [ ] T103 `llm.pricing` and `llm.tokenCap`/`requirePricing`: validator (non-negative finite prices <= 10,000 per 1M, ISO currency, match pattern, no duplicate match, token cap 1,000..1e9), exact-then-glob matcher, cost formula [FR-106, FR-107]
- [ ] T104 Costs and caps: custom-model sessions priced in Cost views and totals, *price unknown* path, other-unit caps shown as not available, forced token cap and require-price on spec 011's cap path; broken pricing blocks custom-model starts [FR-104, FR-107..FR-109]
- [ ] T105 Tests `test-policy-env` and pricing fixtures (negative, string, too large, bad currency, duplicate match, bad glob, token cap out of range; exact vs glob, reasoning as output, unpriced with and without token cap, `requirePricing`), simulator, docs [FR-106..FR-108, FR-140]

## P12: OpenTelemetry per agent app

- [ ] T110 Constitution amendment for Q4 via `/speckit-constitution` (hard prerequisite: no other P12 task merges before it)
- [ ] T111 No-prompt checks: Codex per-thread `[otel]`, Copilot OTel variables (`copilot help`) [FR-082, FR-083, FR-142]
- [ ] T112 Mapping per app with percent-encoded headers; missing header variable blocks the start; user OTel variables replaced [FR-080..FR-085]
- [ ] T113 Top-bar and session chip naming the host; first-run notice with the exported fields per app and the "cannot redact" line [FR-086]
- [ ] T114 Tests (header encoding, env binding to the endpoint host, missing variable), Organization page per-app status, docs

## P13: agent, profile and skill registry

- [ ] T120 Index reader, same-origin file URLs, update decisions; `auto` only for local files or signed indexes [FR-060, FR-061, FR-063..FR-065]
- [ ] T121 Install with hash check, path rules (reserved names, trailing dot/space), safe write, ownership per registry and item, uninstall [FR-061, FR-062, FR-065]
- [ ] T122 Powerful-item classification (missing `tools`, `allowed-tools`, prompt `tools`, `permissionMode`, `hooks`, `mcpServers`, non-text files) and the trust step [FR-066]
- [ ] T123 Managed items read-only in the profile editor; install dialog says terminal sessions use them too [FR-067, FR-061]
- [ ] T124 Settings > Agents and skills UI, update badge and toast
- [ ] T125 Tests `test-registry` (including the `reg-*` hostile fixtures), simulator, screenshots, docs

## P14: A6 spend caps

- [ ] T130 Max and default session caps, `requireCap`, daily and monthly limits from the totals [FR-170, FR-171]
- [ ] T131 Tests, docs

## P15: A7 allowed and blocked folders

- [ ] T135 Checks on add and at start after `realpath`, case rules per OS; deny rules passed to apps that accept them [FR-172, FR-173]
- [ ] T136 Tests (Windows/macOS case, symlink escape), docs

## P16: A8 updates key

- [ ] T140 Reserve `updates.mode`/`feedUrl`, Organization page line; the updater's own spec reads it [FR-174, FR-175]

## P17: A9 OS-native sources

- [ ] T145 Windows `HKLM`/`HKCU` `PolicyJson` via `koffi`; ADMX/ADML templates [FR-176]
- [ ] T146 macOS managed preferences, forced values only [FR-176]
- [ ] T147 Precedence and source names; tests with injected readers [FR-177]

## P18: A10 signed config and lists

- [ ] T150 Ed25519 `.sig` verification, `requireFor`, key rotation; signed indexes allow `auto` [FR-178, FR-179, FR-063]
- [ ] T151 Tests (good, bad, missing, rotated key), signing how-to in docs

## P19: A11 audit log

- [ ] T155 JSONL writer with hash chain, events, retention, export [FR-180, FR-181]
- [ ] T156 Tests (chain break detected), docs; OTel export only after its own amendment

## P20: A12 retention

- [ ] T160 Day-based pruning for activity, checkpoints, usage history, logs [FR-182, FR-183]
- [ ] T161 Tests, docs

## P21: A13 rebrand build

- [ ] T165 `dist:rebrand` script: product name, icons, shortcuts, app id suffix, unchanged profile and safeStorage identity [FR-184, FR-185]
- [ ] T166 Tests (config produced), docs

## P22: A14 legal notice

- [ ] T170 Notice from file or URL, acceptance gate, re-show on hash change, Help entry [FR-186, FR-187]
- [ ] T171 Tests, simulator screenshot, docs

## P23: A15 agent-app versions

- [ ] T175 Version range check at detection and before updates [FR-188, FR-189]
- [ ] T176 Tests, docs

## P24: A16 authenticated endpoints

- [ ] T180 `tokenFromEnv` bound to the endpoint host, never across hosts on redirect [FR-190, FR-191]
- [ ] T181 Tests, docs

## P25: A17 sign-in passthrough

- [ ] T185 Read each vendor's login-method settings; map per app; refuse mismatched account type [FR-192, FR-193]
- [ ] T186 Tests, docs

## P26: A18 vendor managed settings view

- [ ] T190 Read-only presence and top-level keys of vendor managed files, masked with `redact.ts` [FR-194, FR-195]
- [ ] T191 Tests (fixtures per vendor path), docs

# Tasks: 012 Claude Code and Codex adapters

Spec: [spec.md](spec.md) | Plan: [plan.md](plan.md) | Research: [research.md](research.md)

**Tags** (in the task line, before the text):
- `(sim)`: needs no account, no vendor installed, no credits. Safe for CI and for any agent.
- `(fixtures)`: uses synthetic fixtures written from vendor docs and types (never `real:`).
- `(needs-owner-approval)`: blocked until the owner says yes in writing: a decision (licence, policy, binary source), a real or paid account, or spending credits. The issue gets the label `needs-owner-approval`. Do not start it.
- `(real-account)`: runs a real vendor session. Always also `needs-owner-approval`. One tiny prompt per check, Read-only unless the check is about writes, usage recorded in the spec, never in CI.

One task = one issue = one pull request. Tick the task in the same pull request. Phases are in [plan.md](plan.md#phased-approach); a task lists what it depends on.

## Done (planning, 2026-10-17)

- [x] T001 Research how Claude Code and Codex can be observed and controlled, what they report, auth and limits ([research.md](research.md)) [FR-003]
- [x] T002 Clarify: decisions, proposals and open questions recorded in spec.md "Clarifications" [FR-003, FR-012, FR-013]
- [x] T003 Plan: architecture, mode and event mapping tables, phases, risks ([plan.md](plan.md)) [FR-003]
- [x] T004 Tasks (this file)
- [x] T005 Analyze by hand: every FR has a task, every `needs-owner-approval` item is tagged, plan references (T040, T041, T044, T052) match this list, no `src/` change in this pull request (see "Analyze notes" at the end)

## Phase 1: simulator-only foundation (no vendor, no account, no credits)

- [x] T010 (sim) Interface deltas (restated 2026-10-18, see `## Changes`): capabilities and displayName (full descriptor in T011), required isLive/dispose, optional listModelOptions/listPreviousSessions/history/setPermMode/debug, StartOptions.permissionMode, UsageEvent costUsd and costBasis; Copilot unchanged and all tests green [FR-002, FR-005]
- [x] T011 (sim) `capabilities.ts` and `registry.ts` (pure): descriptor, id to factory, `AdapterInfo` for the renderer, tests [FR-001, FR-009]
- [x] T012 (sim) `detect.ts` (pure, injected env and exec): binary search order, `--version` parse, minimum version, Windows shims, state `ready|not-installed|too-old|not-signed-in|unknown`, tests on all three path flavours [FR-010, FR-006]
- [x] T013 (sim) Folder store: `adapterId` and `vendorSessionId`, migration of old files, tests in `test-folders.ts` [FR-011]
- [x] T014 (sim) `main.ts`, preload and `api.ts`: route each agent's calls to its adapter, `adapters:list` IPC, only Copilot registered, no renderer change [FR-001, FR-002]
- [x] T015 (sim) `FakeAdapter` (also: drive the `main.ts`/`mcpipc.ts` presence-guard fallbacks for an adapter without the optional members, the T010 known gap) (scripted events, uses the permission broker) and the adapter contract suite `scripts/test-adapter-contract.ts` in `npm test` [FR-007, SC-002]
- [x] T016 (sim) Fake SDK client seam for `CopilotAdapter` so the contract suite also runs on Copilot (also closes part of 002 T020/T025) [FR-007]
- [x] T017 (sim) Picker UI: choose the agent kind when adding a folder or starting a session, "unavailable" state with install hint, capability gating helpers in the renderer; no dead buttons [FR-023, SC-003]
- [x] T018 (sim) Simulator roster with mixed agent kinds and different capabilities (for example no cap chip, no helper tiles); screenshots at 1440x900 and 1280x800; `npm run check:office` green [SC-001, SC-003]
- [x] T019 (sim) Docs for Phase 1: README (adapter table, all "simulator/fixtures only"), `specs/README.md`, spec 002 `## Changes` entry, converge spec/plan/tasks [FR-008, SC-005]

## Phase 2: pure vendor logic with synthetic fixtures (no vendor, no account, no credits)

- [x] T021 (sim) `claudeModes.ts`: mode to SDK options, tool name to permission kind, Read-only `PreToolUse` decision; tests, including unknown tool names treated as non-read [FR-013, FR-004]
- [x] T022 (sim) `codexModes.ts`: mode to `approvalPolicy` and `sandbox`, approval request to permission kind, answer mapping (approve, remember, deny, stop); tests [FR-013, FR-004]
- [x] T023 (fixtures) `claudeMap.ts` plus `scripts/fixtures/claude/` synthetic fixtures (init, streamed text and thinking, tool use and result, MCP tool, sub-agent task, result, error) and `test-claude-map.ts`; MCP name parsed against the init server list [FR-014, FR-018, FR-020]
- [x] T024 (fixtures) `codexMap.ts` plus `scripts/fixtures/codex/` synthetic fixtures (thread, turn, deltas, command, file change, mcpToolCall, sub-agent items, token usage, failure) and `test-codex-map.ts`; unknown notifications ignored [FR-014, FR-018, FR-020]
- [x] T025 (fixtures) Usage and context tests: Claude cost delta from running `total_cost_usd`, per `message.id` dedupe, Codex `modelContextWindow` null as unknown, "credits not reported" for Codex [FR-015, FR-016]
- [x] T026 (sim) Contract case SC-004 for every adapter on fakes: a write attempt is denied in Read-only, pending in Ask first, approved in Allow all; stop with a pending request denies it [FR-013, FR-017, SC-004]
- [x] T027 (sim) Folder trust for project-level vendor settings, as decided in Q8 (2026-10-18): no Claude settings files in any mode (`settingSources: []`), `strictMcpConfig: true` in every mode, tests; no folder-trust dialog [FR-025]
- [x] T028 (sim) Docs for Phase 2: dated `## Changes` entries in specs 003, 011 and 018 (mode wording per agent, usage units, live switch per adapter), README Safety model note, converge [FR-005, FR-008]

## Phase 3: transports on fake processes (still no account, no credits)

- [x] T040 (needs-owner-approval) Decision Q3 and dependency: add `@anthropic-ai/claude-agent-sdk` pinned to an exact version with a dynamic `import()` wrapper; typecheck and build only, nothing started. Depends on the owner accepting its licence [FR-003, FR-020] (done 2026-10-18: owner decided Q3, the SDK stays optional behind a dynamic `import()` (FR-113); issue #48 closed)
- [x] T041 (needs-owner-approval) Decision Q4 and binary source: use the user's installed `claude` via `pathToClaudeCodeExecutable` plus a minimum-version check; a test asserts the vendor binaries are not in `asarUnpack` or the package files [FR-021, FR-010] (done 2026-10-18: the user's installed `claude` with the version probe (FR-036..FR-040); issue #49 closed)
- [x] T042 (sim) `codexRpc.ts`: line-delimited JSON-RPC client over `child_process.spawn` (argv array, absolute path, no shell); tests on a scripted stdio fake: framing, ids, notifications, server requests, malformed lines, child exit [FR-006, FR-020]
- [x] T043a (sim) `CodexAdapter` on a scripted app-server fake, not registered (PR #177) [FR-089..FR-092, FR-094..FR-099]
- [x] T043b (sim) resume with the profile re-check [FR-093] (2026-10-19; real check in the spec)
- [x] T043c (sim) registration behind `DURBAR_CODEX=1`, detector [FR-100] (2026-10-19: offered when installed instead of a hook, FR-145, owner)
- [x] T043 (sim; T043a built 2026-10-18, PR #177, approvals, interrupt and the D5 env deny list included; split 2026-10-18 into T043a fake app-server, handshake, start with the FR-087 refusal, send, turn mapping, stop, crash, contract run; T043b resume with the profile re-check (approvals and interrupt moved into T043a); T043c registration behind `DURBAR_CODEX=1`, detector, env deny list, docs) `CodexAdapter`: initialize, `thread/start` and `thread/resume`, `turn/start`, interrupt, stop, approvals through the broker, crash becomes `error`; contract suite on a scripted app-server fake [FR-003, FR-017, SC-002] (2026-10-19: T043a, T043b and T043c done; real checks T061-T064 and the full app)
- [x] T044 (2026-10-19, CI on macOS, Windows and Linux: `.github/workflows/packaged-check.yml`) Packaged-build check without a vendor: the ESM SDK is imported from the CommonJS main process, `asarUnpack` entries are right, run in CI on three OSes; documents the result [FR-021]
- [x] T044a (2026-10-19) The packaged-build check on Linux, run locally: `scripts/pack-esm-check.js` in `release/linux-unpacked` (see the spec change of that date); CI on three OSes stays open (T044)
- [x] T045 (sim) `ClaudeAdapter` on a fake `query()` object seam: input queue, `canUseTool` to broker, hooks, interrupt, close, resume with `sessionId`; the folder's `CLAUDE.md` with its `@` imports (for example `AGENTS.md`, inside the folder only, bounded size) as an appended system prompt while `settingSources` stays `[]` (owner, 2026-10-18, review of #160); contract suite. Depends on T040, T041 [FR-003, FR-017, SC-002] (done 2026-10-18 as T090-T094 on the CLI transport and the SDK seam; issue #53 closed)
- [x] T046 (sim, Claude half; done as T096-T098, Codex half with #51) Live permission mode switch (spec 018): Claude `setPermissionMode` immediately, Codex from the next `turn/start`; tests and the toast wording [FR-009, C8]
- [x] T047 (sim; the Claude half done as T110 on 2026-10-19, Codex `account/read` open) Availability and sign-in: Codex `account/read` probe, Claude version probe, the "sign in with the CLI in a terminal" message, no prompt ever sent, tests with fakes [FR-010, FR-012] (both halves 2026-10-19: Claude FR-132, Codex FR-137)
- [x] T047b (2026-10-19) (sim, real) Codex sign-in check: `codex login status` in `detectCodex` [FR-137]
- [x] T048 (fixtures) History readers: Claude `listSessions`/`getSessionMessages` and Codex `thread/list`/`thread/turns/list` converted to previous sessions and chat history, same-folder check, size caps, tests [FR-019] (Codex half 2026-10-19: thread/list and thread/read, FR-141; the Claude half was T104-T106)
- [x] T049 (fixtures) Model and effort lists: Claude `supportedModels`, Codex `model/list` to the model picker shape; effort values per model; tests [FR-009] (Codex half 2026-10-19: model/list, FR-142; the Claude half was T099-T101)
- [x] T050 (fixtures; the Claude half done as T111 on 2026-10-19, Codex open) MCP status: Claude init `mcp_servers` and `mcpServerStatus`, `toggleMcpServer`; Codex `mcpServerStatus/list` read-only; capability `mcpToggle` per adapter; tests [FR-024] (Codex half 2026-10-19: FR-147; the Claude half was T111)
- [x] T051 (sim) Redaction: vendor stderr and `DURBAR_LOG` never contain environment values, tokens or key-like strings; tests with planted secrets [FR-006]
- [x] T052 (sim; Claude `AskUserQuestion` done as T107-T109 on 2026-10-19, elicitation and Codex still open) `AskUserQuestion`, MCP elicitation and `request_permissions` in v1: shown as a pending card, answered deny, recorded as `[KNOWN GAP]` (no question UI yet); tests [FR-004] (2026-10-19: Claude T107-T109; Codex questions FR-146 and MCP tool-call elicitation FR-148; form-field elicitations declined, known gap)
- [x] T052b (2026-10-19) Codex request_user_input to the question card [FR-146]; MCP elicitation still open
- [x] T053 (sim) Docs for Phase 3: README adapter section, CHANGELOG Unreleased line, converge spec/plan/tasks, update research.md where the build disproved a `docs:` claim [FR-008] (2026-10-19: research.md findings for Claude and Codex; README and CHANGELOG updated in each pull request)
- [x] T053a (2026-10-19) The Claude half: research.md findings section; README, CHANGELOG and the spec changes were updated in each pull request (#186-#228); the Codex half stays with #51

## Phase 4: real-account verification (spends the owner's credits or needs real accounts)

All of these are blocked until the owner answers Q1 and Q2 in writing (which accounts, which plan, how many prompts, who runs them). Each one records the vendor version, the prompt count and the usage the runtime reported, replaces the matching synthetic fixture with a redacted recorded one (`provenance: recorded`), and moves the matching `[KNOWN GAP]` to `real:` with the date. None runs in CI.

- [x] T060 (complete 2026-10-19: Q1-Q9 answered or settled, see the decision record) Owner decision record: answers to Q1, Q2, Q5 to Q9 written into spec.md, with the prompt budget and the accounts; nothing else in Phase 4 starts before this [FR-022]
- [x] T060a (2026-10-19) Decision record written: Q1-Q5 and Q8 answered or settled; Q6, Q7 and Q9 still open
- [x] T061 (needs-owner-approval) (real-account) Codex: version probe and sign-in state from `account/read` on a real install, no prompt; confirm it costs nothing [FR-010, FR-022] (real 2026-10-19: see the spec, version, initialize, account/read and login status, no prompt)
- [x] T062 (needs-owner-approval) (real-account) Codex: one Read-only prompt, record the event stream, usage, `modelContextWindow` and what `last.inputTokens` means; replace fixtures [FR-007, FR-015, FR-016, FR-022] (2026-10-19: done as T062a)
- [x] T062a (real 2026-10-19) One Read-only prompt and the event kinds, usage and context window recorded; FR-138..FR-140 fixed from what it found
- [x] T063 (needs-owner-approval) (real-account) Codex: interrupt, stop and resume in the same folder (at most 2 prompts) [FR-017, FR-022] (real 2026-10-19: interrupt FR-139, End session, resume FR-093, restart FR-143)
- [x] T064 (needs-owner-approval) (real-account) Codex: Ask first (does a file edit raise an approval in a read-only sandbox?) and the deny path; decide whether Ask first ships for Codex [FR-013, FR-022] (real 2026-10-19, see the spec: Read-only write and outside read refused; Ask first deny and approve)
- [x] T066 (needs-owner-approval) (real-account) Claude: version probe, `accountInfo()` and init `apiKeySource` on a real install, no prompt; confirm nothing is billed [FR-010, FR-022] (real 2026-10-19, see the spec)

- [x] T065 (needs-owner-approval) (real-account) Codex: an MCP tool call, a sub-agent run (child-thread routing) and per-session MCP control; set `helpers` and `mcpToggle` honestly [FR-014, FR-018, FR-024, FR-022] (real 2026-10-19: MCP call and sub-agent, FR-147..FR-149)
- [ ] T066 (needs-owner-approval) (real-account) Claude: version probe, `accountInfo()` and init `apiKeySource` on a real install, no prompt; confirm nothing is billed [FR-010, FR-022]
- [x] T067 (needs-owner-approval) (real-account) Claude: one Read-only prompt, record the stream, usage, cost estimate, `getContextUsage` and `modelUsage`; replace fixtures [FR-007, FR-015, FR-016, FR-022] (2026-10-19: T067a recorded the stream; the redacted real recording `scripts/fixtures/claude/real-readonly-read.json` now runs in `test-claude-map` next to the synthetic ones)

- [x] T066 (needs-owner-approval) (real-account) Claude: version probe, `accountInfo()` and init `apiKeySource` on a real install, no prompt; confirm nothing is billed [FR-010, FR-022] (real 2026-10-19, see the spec: `--version`, `auth status --json` (only `loggedIn` read) and `initialize` for the models; no session created; `accountInfo()` is the SDK's, not used by the CLI transport)
- [x] T067 (needs-owner-approval) (real-account) Claude: one Read-only prompt, record the stream, usage, cost estimate, `getContextUsage` and `modelUsage`; replace fixtures [FR-007, FR-015, FR-016, FR-022] (2026-10-19: T067a and the redacted real fixture)
- [x] T067a (real 2026-10-19) One Read-only prompt: the stream kinds, usage per message and the cost estimate recorded in the spec; no context-window figure is sent (open, see the spec)
- [x] T068 (needs-owner-approval) (real-account) Claude: Read-only really denies writes and shell with a user allow rule present in the user's settings (hook plus `dontAsk`); Ask first and Allow all; interrupt, stop, resume (at most 4 prompts) [FR-013, FR-017, FR-022] (real 2026-10-19, see the spec's Changes: project `.claude/settings.json` and `settings.local.json` allow rules for Write and Bash are ignored, both denied; the user's own `~/.claude` settings were not edited, Durbar does not load them either (`--setting-sources ""`))
- [x] T069 (needs-owner-approval) (real-account) Claude: an MCP tool call (name parsing, `canUseTool.mcpServer`), a sub-agent run with `forwardSubagentText` (ids, text, thinking), tool names missing from the kind table [FR-014, FR-018, FR-022] (done 2026-10-19 with `haiku`, $0.0046; see the spec change of that date)
- [x] T070 (needs-owner-approval) (real-account) Windows and macOS on real machines: `detect()` and shims, spawn, Codex sandbox setup step and Read-only, packaged build with both adapters [FR-010, FR-021, Q9] (closed by the owner's decision, `real:` 2026-10-21, owner (Vikram) hand-check, closed by the owner's decision: macOS in daily use; Windows looked at with a colleague on 2026-10-21. Findings filed from that Windows session: #467 (Settings > Agent apps offered no install option; Copilot was not detected or installable without Node.js; PowerShell/winget commands in PR #469) and the MCP sign-in sharing (#471, merged; real check in PR #478). `[KNOWN GAP]` kept: the Codex sandbox on Windows (`elevatedSandbox` setup, Read-only and Ask first refused, fail closed) and on an ordinary Mac were not reported, and which builds (packaged or source) and which adapters were used on Windows was not recorded; see the spec's Changes, 2026-10-21 *owner hand-check*.)
- [x] T071 (needs-owner-approval) Policy check: ask Anthropic (and read OpenAI's current terms again) before Durbar supports the user's subscription login; record the answer and update README wording (Q1) [FR-012] (settled by the owner 2026-10-19: the user's own installed and signed-in CLI, FR-135/FR-145)

## Phase 5: rollout (after Phase 4)

- [x] T080 (sim) Previous sessions list for both agents in the folder room (read-only, same folder and agent type) using T048; screenshots [FR-019, C11] (both halves: Claude #199, Codex FR-141)
- [x] T081 (decided 2026-10-19 under the owner's grant: yes, a separate dollar cap, FR-150) Decision Q7: a separate dollar cap for Claude (`maxBudgetUsd`) or caps stay Copilot-only; if yes, specify it as a spec 011 delta first [C9]
- [x] T081a Claude dollar cap (FR-150): capUnit, adapter setCap/resolveLimit with --max-budget-usd, main skips AIU caps for usd kinds, renderer unit-aware chip/dialogs/limit card, tests, real check
- [x] T083 Built by spec 061 (issue #289, owner decisions 2026-10-20, PR #424): a folder's hooks, permission rules and `.mcp.json` are listed when the folder is added and apply only once accepted per item (`specs/061-folder-agent-config`); custom agents keep spec 043's per-file confirmation. Originally (backlog, needs-owner-approval) `[KNOWN GAP]` from Q8: a repo's own `.claude` hooks, agents and `.mcp.json` never run in a Claude session from Durbar (the repo's `CLAUDE.md`/`AGENTS.md` instructions are handled by T045, appended system prompt). A way to allow them without letting their `permissions.allow` rules bypass Durbar's modes needs its own spec delta and the owner's OK [FR-025] 2026-10-20 `real:` confirmed on Claude Code 2.1.303 that a folder's hooks and `.mcp.json` do not run (1 prompt, $0.0037; spec `## Changes`); the task itself stays in the backlog.
- [x] T084 (research, then sim) `[KNOWN GAP]` from review of #165: Codex `read-only` sandbox reads anywhere unasked, breaking spec 003 FR-023 parity. Find whether the app-server protocol can limit readable roots (sandbox policy); if yes, use it in `codexModes` and assert read-outside in `test-sc004`; if no, document it in README known limits before T043 ships the Codex adapter [FR-013, FR-084]
- [x] T085 (sim; done 2026-10-19, FR-122, issue #194) Show Claude's dollar estimate (`costUsd`, `costBasis: 'estimate'`) as a labelled estimate in the usage views, never mixed into AIU; per-kind wording for tooltips that say "as reported by the Copilot runtime" (from T028) [FR-015, FR-029]
- [x] T082 (sim) Converge: README "verified" table from `simulator/fixtures only` to what Phase 4 proved, CHANGELOG, spec statuses, `specs/README.md`, close umbrella issue #2 [FR-008, SC-005] (2026-10-19: README table, CHANGELOG, statuses and index converged; umbrella #2 closed)

## Analyze notes (2026-10-17, by hand)

- Coverage: FR-001 T011/T014; FR-002 T010/T014; FR-003 T040-T045; FR-004 T021/T022/T052; FR-005 T010/T028; FR-006 T012/T042/T051; FR-007 T015/T016/T023/T024; FR-008 T019/T028/T053/T082; FR-009 T011/T046/T049; FR-010 T012/T047/T061/T066; FR-011 T013; FR-012 T047/T071; FR-013 T021/T022/T026/T064/T068; FR-014 T023/T024/T065/T069; FR-015/FR-016 T025/T062/T067; FR-017 T026/T043/T045/T063; FR-018 T023/T024/T065/T069; FR-019 T048/T080; FR-020 T023/T024/T040/T042; FR-021 T041/T044/T070; FR-022 T060-T070; FR-023 T017; FR-024 T050/T065; FR-025 T027/T083. SC-001 T018; SC-002 T015/T043/T045; SC-003 T017/T018; SC-004 T026; SC-005 T019/T082.
- Ordering: T010 before T011 to T016; T015 before T026, T043, T045; T021/T022 before T026; T040 and T041 before T045; T048 before T080. T042 to T044 and T047 have no vendor dependency and can run in parallel after Phase 1.
- Gaps recorded rather than hidden (2026-10-19): `[KNOWN GAP]` MCP elicitation with form fields or a URL is declined (FR-147; closed on the simulator and fakes 2026-10-20 by FR-151..FR-155, T114-T117, real check open), Windows Codex sandbox (T070), repo `.claude` hooks/agents/`.mcp.json` not run (T083, closed by spec 061). Closed since: question UI (T052, T052b), Codex per-session MCP and helpers (T065, FR-147..FR-149), the dollar cap (T081, FR-150), Codex reads outside the session folders (T084).
- Contradictions found and fixed while writing: the 2026-10-16 spec said the simulator could be wrapped as an adapter (it is renderer-side: `FakeAdapter` is new, T015); it said `AgentAdapter` was Copilot-agnostic apart from a few parts (`main.ts` also calls six non-interface members: T010).
- No open `[NEEDS CLARIFICATION]` remains in spec.md; the owner questions are Q1 to Q9, each mapped to a blocked task.

## Changes 2026-10-18 (Q3/Q4 decided: CLI and SDK transports; issues #48, #49, #53)

- [x] T090 (sim) `claudeTransport.ts`: transport seam and CLI transport (argv, no shell, JSON lines, control request ids and timeouts, answer-once incoming requests, deny pending on close, redacted stderr tail); `scripts/test-claude-transport.ts` on a scripted fake child [FR-110, FR-111]
- [x] T091 (sim) `claude.ts` `ClaudeAdapter` on the seam (replaces T045's `query()` seam): mapper, broker, PreToolUse hook, interrupt, stop, resume, CLAUDE.md appended prompt; contract suite on a fake transport [FR-112]
- [x] T092 (sim) `claudeSdk.ts`: SDK transport by dynamic import, "not available" without the package; test on a fake module [FR-113]
- [x] T093 (sim) Register Claude Code experimentally (`DURBAR_CLAUDE=1`, `src/adapters/experimental.ts`), `detectorFor('claude')` with a `--version` probe [FR-114]
- [x] T094 (real-account, owner allowed) Real CLI checks with the installed `claude` and `haiku`: one Read-only prompt (stream, usage, cost, no write possible), Ask first approve and deny, interrupt, stop and resume in the same folder; record as `real:` with the cost [FR-110..FR-114]
- [x] T095 (real-account) Offer Claude Code to every user: run the real app with a Claude agent end to end (add a folder, chat, Ask first approval card, stop, restart and resume), with T085 so Claude's dollar estimate is never added to AIU; then move it to `PRODUCTION_DESCRIPTORS` [FR-114] (2026-10-19: owner decision; FR-135/FR-136)
- [x] T113 (sim) FR-135/FR-136: Claude registered without the hook; harness picker only with 2+ ready harnesses, holding the sole ready one when hidden; "Harness" label; tests, docs (2026-10-19)
- T040 and T041 are answered by this entry (no SDK in `package.json` until the owner accepts its terms; the user's `claude` is used); T045 is done as T091.

## Changes 2026-10-18 (issue #54, Claude half of T046)

- [x] T096 (sim) `ClaudeAdapter.setPermMode`: broker mode at once, launched/current hook rule, broker route for launched Allow all in Ask first, relaunch with `--resume` on the next send; `permModeSwitch: 'live'` [FR-115, FR-116]
- [x] T097 (sim) Fake-CLI tests for every launched/current pair, the broker route and the relaunch [FR-117]
- [x] T098 (real-account, owner allowed) One real check: Allow all switched to Read-only during a slow shell command; the later write must not happen [FR-117]

## Changes 2026-10-19 (issue #57, Claude half of T049)

- [x] T099 (sim) `ClaudeAdapter.listModelOptions()` from the `initialize` reply (no prompt, cached), `models`/`effort` capabilities, `--model`/`--effort` rules in `claudeArgs` [FR-118, FR-119]
- [x] T100 (sim) `models:list` per kind (main, preload, simulator), per-kind lists in the toolbar, New session dialog and model chip; FR-062 only for kinds without a list [FR-120]
- [x] T101 Tests on the fake CLI and the simulator; one real probe (no tokens) and one `haiku` prompt from the picker [FR-121]

## Changes 2026-10-19 (issue #196, T095 part 1)

- [x] T102 (sim) Per-kind wording: subtitle, chat footer, Previous sessions header and counts, Copy resume command per kind [FR-123]
- [x] T103 (fixtures) Claude `inputTokens` include cache creation and cache reads; test [FR-124]

## Changes 2026-10-19 (issue #56, Claude half of T048)

- [x] T104 (fixtures) `src/adapters/claudeHistory.ts`: list and replay from Claude's session files (pure parsers on text, small fs wrapper with caps) [FR-125, FR-126]
- [x] T105 (fixtures) `ClaudeAdapter.listPreviousSessions` / `history`, `history: true`; tests on synthetic files [FR-125..FR-127]
- [x] T106 (real-account) T095 rerun: restart, Previous sessions, Resume remembers the earlier turn [FR-127]

## Changes 2026-10-19 (issue #60, Claude half of T052)

- [x] T107 (sim) `question` event and `answerQuestion` (types, main IPC, preload); Claude: the `PreToolUse` hook asks and answers `AskUserQuestion` in every mode [FR-128, FR-129]
- [x] T108 (sim) Question card in the chat, waiting status, simulator question [FR-130]
- [x] T109 Tests on the fake CLI; real check in the three modes with `haiku` [FR-131]

## Changes 2026-10-19 (issue #55, Claude half of T047)

- [x] T110 (sim) Claude sign-in state from `claude auth status --json` after the version probe (only `loggedIn` read); fake-exec tests [FR-132]

## Changes 2026-10-19 (issue #58, Claude half of T050)

- [x] T111 (sim) `setMcpEnabled` over `mcp_toggle` + `mcp_status`, kept for relaunches; `mcpToggle: true`; fake-CLI tests; real check with a stdio MCP server, no prompt [FR-133]
- [x] T112 (2026-10-19) (fixtures, real) Claude context window from `modelUsage.contextWindow` and the last main message's usage; capability `context: true` [FR-134]

## Changes 2026-10-20 (issue #290, MCP elicitation with form fields or a URL)

- [x] T114 (sim) `src/shared/elicit.ts`: the neutral form (fields or URL), schema mapping, main's check, https-only URLs; `question.elicitation`, `elicitAction`, `answerElicitation` in the adapter interface and the event guard [FR-151, FR-155]
- [x] T115 (fakes) Adapters: Copilot `onElicitationRequest`, Codex `mcpServer/elicitation/request` with fields or a URL, Claude control `elicitation`; shared wait-and-answer helper; Stop cancels [FR-152]
- [x] T116 (sim) Question card form (inputs, select, checkbox, password for secrets, labels, required marks, inline messages, Submit / Decline / Cancel), URL mode (host, Open in browser through main, Done / Cancel), IPC and preload, simulator `simelicit=1|url` [FR-153, FR-154]
- [x] T117 Tests: `scripts/test-elicit.ts` (registered as `test:elicit`), Codex and Claude fake-harness cases [FR-151..FR-155]
- [ ] T118 (needs-owner-approval) (real-account) One real MCP server that elicits a form and a URL, on Copilot, Claude Code and Codex [FR-152..FR-154]. (Simulator screenshots of the form and URL cards at 1440x900 and 1280x800: done, `scripts/shots-012-elicit.js`, `docs/screenshots/012-elicit-*`.)

## Changes 2026-10-20 (sign-in checked with the service; a refused session offers Sign in)

- [x] T119 (fakes) `verifySignIn` in the adapter interface; `src/adapters/autherrors.ts` classifier; `withSignIn` uses it (6 s), hints per answer, cached with the list [FR-156]
- [x] T120 (fakes) Copilot `verifySignIn` (`getAuthStatus`, `account.getQuota`, `models.list`), Codex `verifySignIn` (`account/rateLimits/read`, `getAuthStatus` fallback without the token), Claude `verifySignIn` (local only); fake SDK and fake app-server switches; tests [FR-156]
- [x] T121 (fakes) `errorKind: 'auth'` on the normalized `error` status; Copilot, Codex and Claude mapping (result, assistant marker, synthetic message, stderr at exit); event guard; tests with the owner's real 401 text [FR-157]
- [x] T122 (sim) Main marks the app `not-signed-in` and sends `adapters:changed`; chat sign-in card (Sign in through `DurbarHarnesses.signIn`, Signed in ✓, Send again after a restart, the before-send card that keeps the typed text); `src/renderer/signin.js` with tests [FR-157]
- [x] T123 (sim) Simulator `simauth=out|expired`; driver `scripts/shots-012-signin-chat.js` [FR-157]
- [ ] T124 (real-account) The lead checks on real accounts: an expired or revoked sign-in for Copilot, Claude Code and Codex shows Not signed in after Check again (Copilot, Codex) or at the first message (Claude), the card's Sign in and Send again work, and the screenshots from `scripts/shots-012-signin-chat.js` at 1440x900 and 1280x800 [FR-156, FR-157] 2026-10-20 partly: Copilot (refused token) and Codex (broken access token) give signed-out from `verifySignIn`; Copilot's real Send error was missed by the classifier and is now caught (spec `## Changes`). Open: a real expired Claude sign-in, the card in the full app, screenshots.

## Changes 2026-10-20 (Copilot's shared runtime picks up a new sign-in)

- [x] T125 (fakes) Optional `refreshAuth()` in the adapter interface; Copilot stops and recreates its shared client and resumes the live sessions on it ("Reconnecting Copilot…"); main calls it after a sign-in that ended well, before detection and `harness:done` (`afterSignIn`); `RestartingFakeCopilot` and tests in `test:authcheck` [FR-158]
- [x] T126 (2026-10-20) Chat sessions start with `CLAUDE_CODE_ENTRYPOINT=agent-durbar` so `claude --resume` lists them; probe, handoff and one-shot runs unchanged; unit test; real check recorded [FR-159]

## Changes 2026-10-22 (a token after an underscore, FR-080 delta, issue #541)

- [x] T127 (2026-10-22) `redact`'s token shapes start where no letter or digit precedes them instead of at `\b` (`_ghp_…_`, `__sk-…__`, `my_github_pat_…` are masked); a JWT may follow up to 3 underscores; `maskTokenShapes` exported and reused by `shownCommand` in `src/main/foldersetup.ts` (its `\b` copy removed); wrapping matrix, adversarial underscore runs and mutation checks in `test:redact` and `test:foldersetup` [FR-080]
- [x] T128 (2026-10-22, review of PR #543) The JWT shape takes the underscore and `snake_case` wrappings too (`my_eyJ…`, `MY__eyJ…`, `____eyJ…`; prefix kept, start still linear); the `[KNOWN GAP]` exemptions leave `test:redact`; `test:foldersetup` gets JWT cases in the `shownCommand` token loop; mutation checks [FR-080]
- [x] T129 (2026-10-22, review of PR #543) The token shapes (`gh[pousr]_`, `github_pat_`, `sk-`, `Bearer`, AWS, `Authorization:`, URL credentials, JWT) may also start right after a percent-encoded byte `%XX` (and `%25XX` up to 4 times), so `?q=token%3Dghp_…` is masked; percent wrappings in the matrix, normal-text near misses, adversarial 1 MB `%3D` runs (CPU time) and mutation checks in `test:redact` and `test:foldersetup` [FR-080]
- [x] T130 (2026-10-22, review of PR #549) Token shapes also start after a backslash escape (`\n`, `\t`, `\r`, `\b`, `\f`, `\v`, `\uXXXX`, `\xXX`), so the debug log (`createDebugSink`, redacted after `JSON.stringify`) masks a token at the start of a line; the percent start covers any depth of `%25` with `(?<=(?:%|25)[0-9A-Fa-f]{2})` (KNOWN GAP of 4 levels removed); `\n`, `\t`, `=` and 4- and 6-level `%25` wrappings in `test:redact` and `test:foldersetup`, a `createDebugSink` case, adversarial 1 MB `\\n` and `%25` runs, mutation checks [FR-080]
- [x] T131 (2026-10-23, issue #551) `TOKEN_SHAPES` mask Slack tokens (`xox[abprse]-`, `xapp-`), the secret path of Slack incoming webhooks and Discord webhooks (host kept) and Telegram bot tokens (bare and after `api.telegram.org/bot`); the start also accepts `=XX` (quoted-printable) and `%uXXXX`; WRAPS, false-positive, 1 MB adversarial and mutation checks in `test:redact` and `test:foldersetup` [FR-080]

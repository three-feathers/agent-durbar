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
- [ ] T025 (fixtures) Usage and context tests: Claude cost delta from running `total_cost_usd`, per `message.id` dedupe, Codex `modelContextWindow` null as unknown, "credits not reported" for Codex [FR-015, FR-016]
- [x] T026 (sim) Contract case SC-004 for every adapter on fakes: a write attempt is denied in Read-only, pending in Ask first, approved in Allow all; stop with a pending request denies it [FR-013, FR-017, SC-004]
- [x] T027 (sim) Folder trust for project-level vendor settings, as decided in Q8 (2026-10-18): no Claude settings files in any mode (`settingSources: []`), `strictMcpConfig: true` in every mode, tests; no folder-trust dialog [FR-025]
- [ ] T028 (sim) Docs for Phase 2: dated `## Changes` entries in specs 003, 011 and 018 (mode wording per agent, usage units, live switch per adapter), README Safety model note, converge [FR-005, FR-008]

## Phase 3: transports on fake processes (still no account, no credits)

- [ ] T040 (needs-owner-approval) Decision Q3 and dependency: add `@anthropic-ai/claude-agent-sdk` pinned to an exact version with a dynamic `import()` wrapper; typecheck and build only, nothing started. Depends on the owner accepting its licence [FR-003, FR-020]
- [ ] T041 (needs-owner-approval) Decision Q4 and binary source: use the user's installed `claude` via `pathToClaudeCodeExecutable` plus a minimum-version check; a test asserts the vendor binaries are not in `asarUnpack` or the package files [FR-021, FR-010]
- [x] T042 (sim) `codexRpc.ts`: line-delimited JSON-RPC client over `child_process.spawn` (argv array, absolute path, no shell); tests on a scripted stdio fake: framing, ids, notifications, server requests, malformed lines, child exit [FR-006, FR-020]
- [ ] T043 (sim) `CodexAdapter`: initialize, `thread/start` and `thread/resume`, `turn/start`, interrupt, stop, approvals through the broker, crash becomes `error`; contract suite on a scripted app-server fake [FR-003, FR-017, SC-002]
- [ ] T044 (sim) Packaged-build check without a vendor: the ESM SDK is imported from the CommonJS main process, `asarUnpack` entries are right, run in CI on three OSes; documents the result [FR-021]
- [ ] T045 (sim) `ClaudeAdapter` on a fake `query()` object seam: input queue, `canUseTool` to broker, hooks, interrupt, close, resume with `sessionId`; the folder's `CLAUDE.md` with its `@` imports (for example `AGENTS.md`, inside the folder only, bounded size) as an appended system prompt while `settingSources` stays `[]` (owner, 2026-10-18, review of #160); contract suite. Depends on T040, T041 [FR-003, FR-017, SC-002]
- [ ] T046 (sim) Live permission mode switch (spec 018): Claude `setPermissionMode` immediately, Codex from the next `turn/start`; tests and the toast wording [FR-009, C8]
- [ ] T047 (sim) Availability and sign-in: Codex `account/read` probe, Claude version probe, the "sign in with the CLI in a terminal" message, no prompt ever sent, tests with fakes [FR-010, FR-012]
- [ ] T048 (fixtures) History readers: Claude `listSessions`/`getSessionMessages` and Codex `thread/list`/`thread/turns/list` converted to previous sessions and chat history, same-folder check, size caps, tests [FR-019]
- [ ] T049 (fixtures) Model and effort lists: Claude `supportedModels`, Codex `model/list` to the model picker shape; effort values per model; tests [FR-009]
- [ ] T050 (fixtures) MCP status: Claude init `mcp_servers` and `mcpServerStatus`, `toggleMcpServer`; Codex `mcpServerStatus/list` read-only; capability `mcpToggle` per adapter; tests [FR-024]
- [x] T051 (sim) Redaction: vendor stderr and `DURBAR_LOG` never contain environment values, tokens or key-like strings; tests with planted secrets [FR-006]
- [ ] T052 (sim) `AskUserQuestion`, MCP elicitation and `request_permissions` in v1: shown as a pending card, answered deny, recorded as `[KNOWN GAP]` (no question UI yet); tests [FR-004]
- [ ] T053 (sim) Docs for Phase 3: README adapter section, CHANGELOG Unreleased line, converge spec/plan/tasks, update research.md where the build disproved a `docs:` claim [FR-008]

## Phase 4: real-account verification (spends the owner's credits or needs real accounts)

All of these are blocked until the owner answers Q1 and Q2 in writing (which accounts, which plan, how many prompts, who runs them). Each one records the vendor version, the prompt count and the usage the runtime reported, replaces the matching synthetic fixture with a redacted recorded one (`provenance: recorded`), and moves the matching `[KNOWN GAP]` to `real:` with the date. None runs in CI.

- [ ] T060 (needs-owner-approval) Owner decision record: answers to Q1, Q2, Q5 to Q9 written into spec.md, with the prompt budget and the accounts; nothing else in Phase 4 starts before this [FR-022]
- [ ] T061 (needs-owner-approval) (real-account) Codex: version probe and sign-in state from `account/read` on a real install, no prompt; confirm it costs nothing [FR-010, FR-022]
- [ ] T062 (needs-owner-approval) (real-account) Codex: one Read-only prompt, record the event stream, usage, `modelContextWindow` and what `last.inputTokens` means; replace fixtures [FR-007, FR-015, FR-016, FR-022]
- [ ] T063 (needs-owner-approval) (real-account) Codex: interrupt, stop and resume in the same folder (at most 2 prompts) [FR-017, FR-022]
- [ ] T064 (needs-owner-approval) (real-account) Codex: Ask first (does a file edit raise an approval in a read-only sandbox?) and the deny path; decide whether Ask first ships for Codex [FR-013, FR-022]
- [ ] T065 (needs-owner-approval) (real-account) Codex: an MCP tool call, a sub-agent run (child-thread routing) and per-session MCP control; set `helpers` and `mcpToggle` honestly [FR-014, FR-018, FR-024, FR-022]
- [ ] T066 (needs-owner-approval) (real-account) Claude: version probe, `accountInfo()` and init `apiKeySource` on a real install, no prompt; confirm nothing is billed [FR-010, FR-022]
- [ ] T067 (needs-owner-approval) (real-account) Claude: one Read-only prompt, record the stream, usage, cost estimate, `getContextUsage` and `modelUsage`; replace fixtures [FR-007, FR-015, FR-016, FR-022]
- [ ] T068 (needs-owner-approval) (real-account) Claude: Read-only really denies writes and shell with a user allow rule present in the user's settings (hook plus `dontAsk`); Ask first and Allow all; interrupt, stop, resume (at most 4 prompts) [FR-013, FR-017, FR-022]
- [ ] T069 (needs-owner-approval) (real-account) Claude: an MCP tool call (name parsing, `canUseTool.mcpServer`), a sub-agent run with `forwardSubagentText` (ids, text, thinking), tool names missing from the kind table [FR-014, FR-018, FR-022]
- [ ] T070 (needs-owner-approval) (real-account) Windows and macOS on real machines: `detect()` and shims, spawn, Codex sandbox setup step and Read-only, packaged build with both adapters [FR-010, FR-021, Q9]
- [ ] T071 (needs-owner-approval) Policy check: ask Anthropic (and read OpenAI's current terms again) before Durbar supports the user's subscription login; record the answer and update README wording (Q1) [FR-012]

## Phase 5: rollout (after Phase 4)

- [ ] T080 (sim) Previous sessions list for both agents in the folder room (read-only, same folder and agent type) using T048; screenshots [FR-019, C11]
- [ ] T081 (needs-owner-approval) Decision Q7: a separate dollar cap for Claude (`maxBudgetUsd`) or caps stay Copilot-only; if yes, specify it as a spec 011 delta first [C9]
- [ ] T083 (backlog, needs-owner-approval) `[KNOWN GAP]` from Q8: a repo's own `.claude` hooks, agents and `.mcp.json` never run in a Claude session from Durbar (the repo's `CLAUDE.md`/`AGENTS.md` instructions are handled by T045, appended system prompt). A way to allow them without letting their `permissions.allow` rules bypass Durbar's modes needs its own spec delta and the owner's OK [FR-025]
- [ ] T086 (research, then sim) `[KNOWN GAP]` from review of #165: Codex `read-only` sandbox reads anywhere unasked, breaking spec 003 FR-023 parity. Find whether the app-server protocol can limit readable roots (sandbox policy); if yes, use it in `codexModes` and assert read-outside in `test-sc004`; if no, document it in README known limits before T043 ships the Codex adapter [FR-013, FR-084]
- [ ] T082 (sim) Converge: README "verified" table from `simulator/fixtures only` to what Phase 4 proved, CHANGELOG, spec statuses, `specs/README.md`, close umbrella issue #2 [FR-008, SC-005]

## Analyze notes (2026-10-17, by hand)

- Coverage: FR-001 T011/T014; FR-002 T010/T014; FR-003 T040-T045; FR-004 T021/T022/T052; FR-005 T010/T028; FR-006 T012/T042/T051; FR-007 T015/T016/T023/T024; FR-008 T019/T028/T053/T082; FR-009 T011/T046/T049; FR-010 T012/T047/T061/T066; FR-011 T013; FR-012 T047/T071; FR-013 T021/T022/T026/T064/T068; FR-014 T023/T024/T065/T069; FR-015/FR-016 T025/T062/T067; FR-017 T026/T043/T045/T063; FR-018 T023/T024/T065/T069; FR-019 T048/T080; FR-020 T023/T024/T040/T042; FR-021 T041/T044/T070; FR-022 T060-T070; FR-023 T017; FR-024 T050/T065; FR-025 T027/T083. SC-001 T018; SC-002 T015/T043/T045; SC-003 T017/T018; SC-004 T026; SC-005 T019/T082.
- Ordering: T010 before T011 to T016; T015 before T026, T043, T045; T021/T022 before T026; T040 and T041 before T045; T048 before T080. T042 to T044 and T047 have no vendor dependency and can run in parallel after Phase 1.
- Gaps recorded rather than hidden: `[KNOWN GAP]` question UI (T052), Codex per-session MCP (FR-024), Codex helpers (T065), Windows Codex sandbox (T070), dollar cap (T081), repo `.claude` hooks/agents/`.mcp.json` not run (T083).
- Contradictions found and fixed while writing: the 2026-10-16 spec said the simulator could be wrapped as an adapter (it is renderer-side: `FakeAdapter` is new, T015); it said `AgentAdapter` was Copilot-agnostic apart from a few parts (`main.ts` also calls six non-interface members: T010).
- No open `[NEEDS CLARIFICATION]` remains in spec.md; the owner questions are Q1 to Q9, each mapped to a blocked task.

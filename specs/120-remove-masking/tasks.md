# Tasks: 120 Remove masking as app functionality (proposal)

**Input**: [spec.md](spec.md), [plan.md](plan.md). **No task starts until the three owners agree to option C in writing.** One PR per stage, in order; tests first; 0 AI credits. Numbers T545..T575, FR-441..FR-460 and Q42..Q45 were reserved for this spec by the coordinator on 2026-11-24 and checked with `npm run specs:numbers` against `origin/main` and the open PR heads.

## Stage 0: decision (owners)

- [ ] T545 The three owners' written decision (A, B or C) recorded under `## Changes` with the date and where each said it; on A or B this spec is marked `superseded`. [section 7]
- [ ] T546 Owners' rule line: no new masking work, no daily masking batch, spec 119 paused (a one-line `AGENTS.md` change by the owners, naming the rule it replaces, FR-063). [section 5 stage 0]
- [ ] T547 Each stage PR (1 to 5) keeps the two advisory fixes untouched (#1383: `claudeMdPrompt`, `claudeMdNodeIo`, `notPath`; #1416: `agents:selectProfile`, `readAgentFile`, `hashAgentFile`, `shownSha`, `AgentTrustStore`, `claudeAgentOfBytes`, `listClaudeAgents`, `claudeAgentDirs`, `linkedInProject`, `linkedBelow` and the confirmation paths) and runs `test-agentconfirm.ts`, `test-adapter-contract.ts`, `test-claude-adapter.ts` and `test-agentprofiles.ts` green; a stage that edits `test-claude-adapter.ts` changes only its masking asserts. [FR-452]
- [ ] T548 Constitution amendment PR with `/speckit.constitution` (principle III, version 1.2.0 to 1.3.0, Sync Impact Report), text of spec section 4. [section 4]
- [ ] T549 Answers to Q42, Q43, Q44 and Q45 written into the spec; FR-442 and the amendment follow Q45. [section 6]

## Stage 1: no agent text in logs, saved state or outbound sinks (depends on stage 0)

- [ ] T550 Planted-marker unit tests first, one per main-side sink with its own mutant (a mutant that writes the marker into that sink fails at that sink's own assert): `activity.json` for every row kind, `schedules.json`, stderr (`failText`, the save error), the `DURBAR_LOG` sink, the crash marker, usage and away-summary stores, the Durbar MCP read tools; marker kinds of FR-450 including tool name, session title and the loop pace line. [FR-450]
- [ ] T551 Fake-transport test of the Claude and Codex exit handlers (stderr carrying the marker, debug lines captured); window driver under `DURBAR_SIM` for the screen, Copy and export; a `DURBAR_SIM_MAIN` pass where it reaches, listed as extra. [FR-441, FR-447, FR-450]
- [ ] T552 Activity rows per kind as FR-443 lists (permission rows: kind and program or tool name; loop rows without the agent's reason; the other kinds as today); this run's full text from memory; old rows rewritten on read; `test-activity.ts` updated. [FR-443]
- [ ] T553 `failText` and the other main log lines: place, class name, code only; the test driver's own failure stack is the named exception. [FR-444]
- [ ] T554 `DURBAR_LOG` records kinds, ids, phases, lengths and codes; adapters' debug lines lose stderr text. [FR-445]
- [ ] T555 Durbar MCP read tools return name, transport, on/off and health of MCP servers; spec 041 delta. [FR-446]
- [ ] T556 Values Durbar holds by field (MCP extras' environment and header values) reach no window, log or agent: "set" or "not set"; tests. [FR-449]
- [ ] T557 Loop pace reason: `schedules.json` keeps minutes, source and fixed end words, never the agent's reason; the window shows this run's reason from memory. [FR-453]

## Stage 2: window masks (depends on stage 1)

- [ ] T558 Remove `src/renderer/safetext.js` and the window's mask calls; keep the invisible-character marks. [FR-441]
- [ ] T559 Remove the FR-197 sink table (`scripts/test-live-mask.ts`) and the window mask drivers and tests (section 5 stage 2 list); update the mixed tests' asserts. [FR-441]

## Stage 3: main-side shown-text masks (depends on stage 2)

- [ ] T560 Remove `convmask.ts`, `mcpmask.ts`, `activitymask.ts` and the mask calls in main, MCP, notes, brain view, sandbox and adapters; notes store what is saved. [FR-441, FR-447]
- [ ] T561 Remove `maskOutgoing` from team briefs; spec 084 send check moot. [FR-448]
- [ ] T562 Remove the main-side mask tests (section 5 stage 3 list) and update mixed tests. [FR-441]

## Stage 4: the shared library (depends on stage 3)

- [ ] T563 Move the kept helpers (`cut`, `unhide`, `HIDDEN_CHARS`, `shQuote`, `shellWords`, `parseFlag`, `hasShellJoin`, `secretFlag`, `envVarName`) to one shared text module; update imports; their tests stay. [plan, technical context]
- [ ] T564 Delete `src/shared/redact.ts` and its tests, growth and held libraries, the frozen reference fixture and the outgoing-mask tests. [section 5 stage 4]

## Stage 5: docs and spec status (depends on stage 4)

- [ ] T565 docs/safety.md: the one line of FR-451 and the list of what is kept and never written; docs/features.md, README, docs/agent-notes.md masking lines. [FR-451]
- [ ] T566 Dated deltas in specs 012, 041, 052, 084, 105, 005, 045, 058, 083 and 119 (status `superseded` for 119 and spec 012's masking FRs). [section 5 stage 5]
- [ ] T567 Changelog fragment telling users, as Q44 decides. [Q44]
- [ ] T568 `/speckit.converge`: this spec's status and evidence tags match what was built. [all]

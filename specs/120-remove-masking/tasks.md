# Tasks: 120 Remove masking as app functionality (proposal)

**Input**: [spec.md](spec.md), [plan.md](plan.md). **No task starts until the three owners agree to option C in writing.** One PR per stage, in order; tests first; 0 AI credits. Numbers T545..T575, FR-441..FR-460 and Q42..Q44 were reserved for this spec by the coordinator on 2026-11-24 and checked with `npm run specs:numbers` against `origin/main` and the open PR heads.

## Stage 0: decision (owners)

- [ ] T545 The three owners' written decision (A, B or C) recorded under `## Changes` with the date and where each said it; on A or B this spec is marked `superseded`. [section 7]
- [ ] T546 Owners' rule line: no new masking work, no daily masking batch, spec 119 paused (a one-line `AGENTS.md` change by the owners, naming the rule it replaces, FR-063). [section 5 stage 0]
- [ ] T547 Each stage PR (1 to 5) keeps the two advisory fixes (#1383 for GHSA-9w5g, #1416 for GHSA-5h28) untouched and runs `scripts/test-agentconfirm.ts`, `scripts/test-agentprofiles.ts`, `scripts/test-adapter-contract.ts` and `scripts/test-claude-adapter.ts` green; a stage that edits `test-claude-adapter.ts` changes only its masking asserts. [FR-452]
- [ ] T548 Constitution amendment PR with `/speckit.constitution` (principle III, version 1.2.0 to 1.3.0, Sync Impact Report), text of spec section 4. [section 4]
- [ ] T549 Answers to Q42, Q43, Q44 written into the spec. [section 6]

## Stage 1: no agent text in logs, saved state or outbound sinks (depends on stage 0)

- [ ] T550 Planted-marker test first: `scripts/test-planted-marker.ts` (simulator, main-side stores with an injected folder, stderr captured, a `DURBAR_LOG` file in a temp folder, Durbar MCP read replies) with a run-time random marker in every kind of agent output; a mutant (the debug sink without its mask) must fail it. [FR-450]
- [ ] T551 Window side of the marker test: one driver asserts the marker is shown where the agent sent it and that Copy and export hold exactly what is shown. [FR-441, FR-447, FR-450]
- [ ] T552 Activity row stores kind, program or tool name and decision, not the request text; this run's full text from memory; old rows' action text cleared on read; `test-activity.ts` updated. [FR-443]
- [ ] T553 `failText` and the other main log lines: place, class name, code only. [FR-444]
- [ ] T554 `DURBAR_LOG` records kinds, ids, phases, lengths and codes; adapters' debug lines lose stderr text. [FR-445]
- [ ] T555 Durbar MCP read tools return name, transport, on/off and health of MCP servers; spec 041 delta. [FR-446]
- [ ] T556 Values Durbar holds by field (MCP extras' environment and header values) reach no window, log or agent: "set" or "not set"; tests. [FR-449]

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

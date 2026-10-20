# Specification Quality Checklist: MCP servers in a session (status words, Restart, last error, log folder)

**Purpose**: Validate specification completeness and quality before proceeding to implement
**Created**: 2026-10-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Focused on user value (the owner's "not clear how to start them" and the missing VS Code controls)
- [x] Written so the owner can answer the questions without reading code
- [x] All mandatory sections completed (scenarios, requirements, success criteria, assumptions)
- [ ] No implementation details: the spec names vendor calls (`restartServer`, `mcp_reconnect`) and IPC channels. Kept on purpose, as in
  specs 012, 019 and 054: whether a control exists at all depends on them, and the owner must see what each choice rests on

## Requirement Completeness

- [x] No open questions remain: Q1-Q11 answered by the owner on 2026-10-20 (all A)
- [x] Requirements are testable (each FR maps to a unit test, a fake test, a simulator step or a real-check task)
- [x] Success criteria are measurable (SC-001..SC-005)
- [x] Acceptance scenarios defined per user story
- [x] Edge cases identified (unknown states, double press, ended session, long errors, per-OS paths)
- [x] Scope bounded: no MCP sign-in, no in-app log text, no change to Settings or folder extras stores
- [x] Dependencies and assumptions identified (SDK pin, Claude CLI version, Codex protocol)

## Constitution

- [x] II: vendor calls and log locations stay in adapters; renderer gets words and booleans
- [x] III: errors masked in main; logs revealed, never read or copied; no path to the renderer; busy confirmation
- [x] IV: simulator, fakes and unit tests; real checks no-prompt and owner-gated
- [x] V: words plus icons, 10.5px, list scrolls inside the dialog
- [x] VI: per-OS log folders from one pure function, tested for all three
- [x] VIII: `read:` / `[KNOWN GAP]` marked; "not checked on a real account yet" in the UI and README until Phase 6

## Feature Readiness

- [x] Every FR has a task (see tasks.md cross-references)
- [x] User stories are independently testable; MVP = US1 + US2
- [x] Ready for `/speckit-implement` (T001 done)

## Notes

- Research is read-only (types, docs, program strings, upstream source); nothing was run on a real account and no log file was opened.
- Hand analyze pass (2026-10-20): every FR maps to a task; fixed an unclear acceptance line (US4), an unverified claim about pending
  requests at End (now `read:`), the split between what main enforces and when the renderer asks (FR-022/FR-023), and missing task links
  for FR-051/FR-052. Found outside this spec: spec 019 FR-008 says running sessions change only through the switch (a dated note in 019
  now points to 058's Restart session); spec 012 FR-024 still says Codex `mcpToggle: false` while FR-147 made it true (not changed here);
  the per-agent dialog passes MCP errors to the renderer unmasked and claims "applies right away" for Codex (both fixed by 058 FR-005 and
  FR-002 once built).
- Clarify (2026-10-20): owner chose option A for Q1-Q11. Second hand analyze pass: the spec, plan, research, data model and tasks now
  name the chosen answers; the non-chosen options were removed from the work (T080 log viewer dropped, no new-session restart, no Codex
  reload, no early Claude launch, no `stopServer`) and are listed as out of scope in tasks.md. No contradiction left with specs
  019/012/005/006/054 or the constitution.

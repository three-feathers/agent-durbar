# Specification Quality Checklist: Rename sessions

**Purpose**: Validate specification completeness and quality before planning is acted on
**Created**: 2026-10-20
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] Focused on user value (short names of the user's own, no private prompt text on screen)
- [x] Written so the owner can answer the questions without reading code
- [x] All mandatory sections completed (scenarios, requirements, success criteria, assumptions)
- [ ] No implementation details: the spec names vendor calls (`name.set`, `thread/name/set`) and IPC channels. Kept on purpose, as in
  specs 006, 012 and 058: what Durbar can promise depends on them, and the owner must see what each choice rests on

## Requirement Completeness

- [ ] No open questions remain: Q1-Q9 wait for the owner (each has a recommended option)
- [x] Requirements are testable (each FR maps to a unit test, a fake test, a simulator step or a real-check task)
- [x] Success criteria are measurable (SC-001..SC-005)
- [x] Acceptance scenarios defined per user story
- [x] Edge cases identified (helpers, lazy and ended cards, later title changes, deletes, long names, schedules file)
- [x] Scope bounded: no VS Code chat names (Q5), no rename of folders or floors (they have their own)
- [x] Dependencies identified (spec 006 #368 row menu, spec 044 #371 short name, SDK pin, Codex minimum)

## Constitution

- [x] II: vendor calls stay in adapters; the renderer gets a capability value and words
- [x] III: name rule with secret check; no other tool's files written; main validates IPC and re-checks folder membership
- [x] IV: simulator, fakes and unit tests; `/rename` never sent; real checks owner-gated
- [x] V: one dialog, existing menus, 60-character cap, `check:office` with long names
- [x] VI: nothing per OS
- [x] VIII: `read:` / unverified marked; VS Code visibility `[KNOWN GAP]`

## Feature Readiness

- [x] Every FR has a task (tasks.md names the FRs)
- [x] User stories are independently testable; MVP = US1
- [ ] Ready for `/speckit-implement`: after T001 (owner answers)

## Analyze pass (2026-10-20)

- Coverage: FR-001..FR-016 each appear in at least one task; SC-001..SC-005 map to T029, T010, T033.
- Consistency: the 60-character cap appears in FR-002, FR-004, FR-016 and T010 (Q3 may change all four together); the schedules cap 40
  matches spec 044 FR-021 (#371).
- Cross-spec: spec 006 FR-027 (#368) owns the row menu; this spec only adds an item (T040). Spec 006 FR-031 says a later change may show
  the alias in the delete row; FR-012 covers it. Spec 001's 2026-10-18 delta (titles on cards) is extended, not contradicted: FR-003 hides
  the runtime title only when the user named the session.
- Risk: Copilot `name.set` is @experimental; FR-010 falls back to a Durbar-only name on any error.

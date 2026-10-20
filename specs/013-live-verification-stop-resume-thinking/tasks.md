# Tasks: live verification (013)

- [x] T001 Checklist with expected results, prompt cost and the FR each check closes [FR-001]
- [x] T002 Budget and approval recorded (owner's standing instruction, 2026-10-18); prompts and AIU spent recorded [FR-002]
- [x] T003 Run C1-C7 in the real app with a real Copilot session; record date, OS, results [FR-003]
- [x] T004 Update the owning specs: 005 FR-012, FR-013; 006 FR-009 (and their tasks T021, T024) [FR-004]
- [x] T005 Redacted event fixtures from a real run for credit-free tests [FR-005] (2026-10-19: event mapping and models already ran on real captures since spec 015, `scripts/fixtures/events/auto-*.json`, `mcp-tool-usage.json` and `models/real-list-models-*.json`; history now on `events/real-getevents-restart.json`, see 006 T023)
- [ ] T006 C8 several models and effort (an account with more than `auto`) [007] 2026-10-20: still blocked, 0 prompts: the Copilot login lists no models (free plan; see spec `## Changes`).
- [ ] T007 C9 a real cap (minimum 30 AIU) [011] 2026-10-20: skipped, 0 prompts: a tiny prompt on `auto` costs 0.07-0.26 AIU, so reaching the 30 AIU minimum takes over 100 prompts, or a few long ones (about 0.3 USD of credits) that would eat most of the free plan's monthly chat quota; it waits for the paid plan.
- [ ] T008 C10 VS Code visibility, packaged app on macOS and Windows [009, 008]

# Tasks: Office assistant (048)

All tasks wait for the owner's answers (spec.md, open questions).

## Phase 1 (local query layer)

- [ ] T001 `officequery.ts`: the waiting list, working-on, finished today, last hour, usage by folder and harness (units apart), longest running and most tokens; unit tests [FR-002, FR-004]
- [ ] T002 Event timeline per agent, bounded, status changes only [FR-003]
- [ ] T003 Panel, question chips, rows with links; simulator; `check:office` at both sizes [FR-001, FR-007, SC-001]

## Phase 1b (model layer, if Q1 says yes)

- [ ] T010 Assistant session with no tools and no MCP, in a private folder, Read-only, capped [FR-005]
- [ ] T011 Snapshot builder with limits and the untrusted-data preamble; tests [FR-006]
- [ ] T012 One real check per harness, recorded as `real:` [SC-004]

## Later

- [ ] T020 Mobile (Q3), T021 persisted timeline (Q4), T022 supervised actions (Q5)

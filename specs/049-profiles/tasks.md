# Tasks: Profiles (049)

All tasks wait for the owner's answers (spec.md, open questions).

## Phase 1 (separate offices, shared sign-ins)

- [ ] T001 Profile store and `userDataFor`; the default profile in place; unit tests [FR-001]
- [ ] T002 `--profile` at startup and relaunch on switch with a confirmation; ending sessions cleanly [FR-002]
- [ ] T003 Selector in the top bar and Settings > Profiles; simulator at both sizes [FR-003]

## Research (before Phase 2)

- [ ] T010 R1 per OS: where each vendor login stores credentials with the home variable set; two runtimes at once; no prompts; owner approval for real accounts
- [ ] T011 R2: Previous sessions and resume per home

## Phase 2 (separate sign-ins)

- [ ] T020 Harness homes per profile, applied in each adapter; detection per profile; sign-in commands shown [FR-004, FR-005]
- [ ] T021 Real check with two accounts, recorded as `real:` [SC-003]

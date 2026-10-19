# Tasks: Harness setup inside the app (spec 051, issue #299)

- [ ] T001 `src/shared/harnesssetup.ts`: install and update plans per harness and OS, sign-in plans, output parsing (ANSI, link, code, paste prompt), link allowlist, paste rules, official pages; unit tests on the outputs captured 2026-10-19 [FR-002, FR-003, FR-005]
- [ ] T002 `src/main/harnesssetup.ts`: runner (argv, Windows `.cmd`, one at a time, timeouts, tree kill, last lines through `redact()`, paste to stdin, re-detect on exit); unit tests with a fake spawn [FR-004, FR-005]
- [ ] T003 Copilot `authStatus()` on the shared client; IPC `harness:copilotAuth` [FR-007]
- [ ] T004 IPC and preload: `harness:plans`, `harness:run`, `harness:paste`, `harness:cancel`, progress and done events; `DurbarApi` [FR-004, FR-005]
- [ ] T005 Settings > Harnesses cards; install, update and sign-in dialogs; Copilot CLI first when missing [FR-001, FR-003, FR-006]
- [ ] T006 Entry points: welcome screen link, New session hint *Set up…* [FR-008]
- [ ] T007 Simulator states and canned flows; screenshots at 1440x900 and 1280x800 [FR-009]
- [ ] T008 Real check on this machine: a sign-in flow through the app with an isolated config folder, stopped before it finishes; npm install into a temporary prefix [SC-001, SC-002]
- [ ] T009 Docs: README (Install, Harnesses), CHANGELOG, specs index; `[KNOWN GAP]`s for routes not tried

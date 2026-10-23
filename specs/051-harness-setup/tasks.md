# Tasks: Harness setup inside the app (spec 051, issue #299)

- [x] T001 `src/shared/harnesssetup.ts`: install and update plans per harness and OS, sign-in plans, output parsing (ANSI, link, code, paste prompt), link allowlist, paste rules, official pages; unit tests on the outputs captured 2026-10-19 [FR-002, FR-003, FR-005]
- [x] T002 `src/main/harnesssetup.ts`: runner (argv, Windows `.cmd`, one at a time, timeouts, tree kill, last lines through `redact()`, paste to stdin, re-detect on exit); unit tests with a fake spawn [FR-004, FR-005]
- [x] T003 Copilot `authStatus()` on the shared client; IPC `harness:copilotAuth` [FR-007]
- [x] T004 IPC and preload: `harness:plans`, `harness:run`, `harness:paste`, `harness:cancel`, progress and done events; `DurbarApi` [FR-004, FR-005]
- [x] T005 Settings > Harnesses cards; install, update and sign-in dialogs; Copilot CLI first when missing [FR-001, FR-003, FR-006]
- [x] T006 Entry points: the welcome card's *Set up harnesses…* and the same button in "About agent kinds" (the New session dialog's "?") [FR-008]
- [x] T007 Simulator states and canned flows; screenshots at 1440x900 and 1280x800 [FR-009]
- [x] T008 Real check on this machine: the three sign-in flows through the runner with isolated config folders, cancelled before they finish (no install was run for real: `[KNOWN GAP]`) [SC-001, SC-002]
- [x] T009 Docs: README (Install, Harnesses), CHANGELOG, specs index; `[KNOWN GAP]`s for routes not tried
- [x] T010 Signed-in account per agent app (delta 2026-10-23, issue #617): `src/shared/account.ts` (`AccountIdentity`, `accountLine`, `cleanName`), adapter `accountInfo()` for Copilot (`getAuthStatus`), Claude Code (`auth status --json`) and Codex (`account/read`), main cache and IPC `harness:accounts` (cleared after a sign-in, none under the simulator), Settings card line, picker tooltips and "About agent apps", simulator fake identity; `test:account` (fake answers per app, the cache, the identity kept out of logs) and `scripts/shots-051-account.js`; README, changelog fragment, screenshots [FR-011..FR-015]
- [x] T011 Account name hidden until revealed, and the review on #620 (delta 2026-10-23): `maskName` and the masked view, the blurred name with a labelled eye button in Settings (per view, never saved), masked picker tooltips and About agent apps, Copilot logins too; concurrent refreshes joined; the wider no-log check and the 64 KiB output-cap test; driver and screenshots retaken [FR-016, FR-017]

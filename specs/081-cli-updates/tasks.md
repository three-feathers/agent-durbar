---
description: "Tasks for spec 081: agent-app updates"
---

# Tasks: Agent-app updates

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Tests**: required (constitution VII). Every new rule gets a unit test, plus a planted mutation that the test catches, named in the PR.

**Format**: `[ID] [P?] [Story] Description`. **[P]** means the task can run in parallel with others (different files).

Nothing here is started (2026-10-23). The owner starts implementation after review.

## Phase 1: Setup

- [ ] T001 [P] Fixtures in `scripts/fixtures/updatecheck/`, each with a header comment naming its source (`read:` doc page or a recorded run):
  - `npm view <pkg> version --json` for the three packages, plus an error from an unreachable registry;
  - `brew info --cask --json=v2` and `brew outdated --cask --json=v2` for `codex`, `claude-code`, `claude-code@latest` and `copilot-cli` (`auto_updates`);
  - GitHub `releases/latest` JSON for openai/codex (`rust-v…`) and github/copilot-cli (`v…`);
  - the Claude channel text;
  - winget tables as placeholders marked "to replace with a recorded run" (T041).
- [ ] T002 [P] Add `test:updatecheck` to `package.json` (append to `test:serial`, keep `main`'s list).

## Phase 2: Foundational (blocks every story)

- [ ] T003 `src/shared/updatecheck.ts`: `sourceOf(realPath, platform, env)` (plan D2) on top of `routeOwning`. Cover npm (same Node bin folder, prefix match), brew (prefix plus cask from `Caskroom/<cask>/`), winget, official (Codex `packages/standalone`, `~/.copilot/pkg`, `~/.local/share/claude/versions`), and outside (`/usr/bin` distro, `/snap/`, Scoop). Uses `path.win32`/`path.posix`, case-insensitive on Windows and macOS. Test: a matrix per OS, symlinked `/usr/local/bin` on an Intel Mac, look-alike paths (`/x/Caskroomy/`), hostile and long paths. Mutations: drop the realpath requirement for `/usr/local`; compare case-sensitively on win32.
- [ ] T004 `src/shared/updatecheck.ts`: the check argv table (plan D3), parsers and decision.
  - Output is capped at 64 KiB and stripped of ANSI and control characters; JSON is size-capped. A version must pass `parseVersion` and be at most 64 characters.
  - Compare is stable-first and pre-release-aware (FR-005). A source behind the installed version gives no Update.
  - Tests: every T001 fixture, hostile output (huge, markup, `__proto__` JSON, a version with HTML), a pre-release installed, and the downgrade case.
  - Mutations: accept a 65-character version; treat a pre-release as latest; skip the cap.
- [ ] T005 `src/shared/updatecheck.ts` `classifyFailure` (plan D8, FR-014): admin, in-use, managed (including `claude update` saying "up to date" while a newer version exists), uac-cancelled, network, other. Test each class with fixtures per OS. Mutation: drop the Windows `EBUSY` pattern.
- [ ] T006 `src/main/officialinstall.ts`: the `VERSION_SOURCES` allow-list (`api.github.com` `/repos/openai/codex/releases/latest` and `/repos/github/copilot-cli/releases/latest`; `downloads.claude.ai` `/claude-code-releases/`), 10 s, 64 KiB, redirects only within the list, no credentials, a plain `User-Agent`. Extend `test-officialinstall`: a look-alike host, an off-list redirect, an oversized body. Mutation: allow any path on `api.github.com`.
- [ ] T007 `src/main/settings.ts`: `announcedVersions` getter and setter with validation (an allowed app id and a valid version string; anything else is dropped). Test: a hostile matrix.

## Phase 3: US1 See whether an app is out of date (P1, MVP)

- [ ] T010 [US1] `src/main/updatecheck.ts` `UpdateChecker`: one app at a time, a 30 s limit, `nodeExec` for tools (brew with `HOMEBREW_NO_AUTO_UPDATE=1`), `HttpGet` for official, and in-memory results with monotonic and wall times. A manual check during the start check joins it. Copilot CLI: version from `--version` only if T040 shows it is offline, else from the copy's package or version folder (FR-002). Test with a fake exec and fake get: one run per app, no doubling, results kept, and no call for an `outside` source.
- [ ] T011 [US1] Start scheduling (plan D6, FR-003, Q1 = C): `main.ts` calls `scheduleStart()` after the first `did-finish-load` and after `adaptersInfo`. It is skipped under the simulator and when policy disallows. Test: a runner-call counter. One call per installed app per start, none from opening Settings or starting a session, none with the policy off (SC-002). Mutation: start before first paint (the driver in T013 catches it; SC-007).
- [ ] T012 [US1] IPC `harness:updates` (get the kept results, `'check'` to check anew) and the event `harness:updatesChanged`; `preload.ts` `harnessUpdates`, `onHarnessUpdates`; `scripts/test-ipc-channels` updated. Sender-frame check as the other harness calls do.
- [ ] T013 [US1] `src/renderer/harnesses.js` card:
  - an *Installed x · <source>* line, *Latest y (as Homebrew knows it)*, the check time, and a chip with a word (*Up to date*, *Update available*, *Could not check*, *Checking…*, *Not checked*);
  - *Check for updates* in the section header and *Check* on each card;
  - the note *Durbar checks for updates each time it starts*;
  - Copilot card: the bundled runtime line, plus the CLI line;
  - every value escaped. Test: escaping with a hostile version and source.

  Simulator driver `scripts/shots-081-updates.js` waits on conditions, never fixed sleeps, and checks that the start check does not delay the office (SC-007). Screenshots `081-updates-*` at 1440x900 and 1280x800.
- [ ] T014 [US1] `src/renderer/sim.ts`: canned results (one up to date, one update available, one could-not-check, one outside) and no network (FR-020). `test:simguard` still passes.

## Phase 4: US2 Update from the owning source (P1, MVP)

- [ ] T020 [US2] `src/shared/harnesssetup.ts`: Copilot brew update adds `--greedy` for the `auto_updates` cask; `claude-code@latest` updates that cask. Own-updater plans: `claude update`, `copilot update`, and `codex update` labelled *undocumented* in the dialog (Q3 = C). For an update, only the owning route is shown, with the others behind *Show other ways* and the second-copy warning (FR-008). Extend `test-harnesssetup`: argv per source and OS, owning route only. Mutation: offer npm first for a brew copy.
- [ ] T021 [US2] `src/main/harnesssetup.ts`: `prepare` accepts an own-updater plan (the app's own binary, real path, `trustedPath`). On a Codex `update` that is missing or failing (not in-use or managed), `finish` reports `fallback: 'official'`, and the window offers the official installer with `CODEX_NON_INTERACTIVE=1` in that child's environment only, after its own native confirmation. Test: missing-command fixture leads to the fallback; in-use leads to no fallback; the environment variable is set only on that child.
- [ ] T022 [US2] Update… shows when `update-available` (as well as `too-old`), unless policy disallows it or the latest is above the policy's `max` (FR-008). After the run, detection runs again; when the version is unchanged or another copy shadows it, the card names both paths (FR-011). An `outside` copy gets no Update and a hint (FR-012). Test: the decision table. Driver: dialog, progress and new version in the simulator.
- [ ] T023 [US2] SC-003: a test that every path to `start` passes the native confirmation (own updater, fallback, waiting update).

## Phase 5: US3 Open sessions (P1, MVP)

- [ ] T030 [US3] `main.ts` `sessionsOf(adapterId)`. `harness:run(..., gate?)` returns `{needsGate:n}`, accepts `wait`/`end`, and keeps a waiting update in memory. While one waits or runs, new sessions of that adapter are refused with a reason (create, start, resume). At 0 it runs `prepare`, the confirmation and `start`; `end` calls `endSessionOp` for each session (plan D5). Copilot CLI: no gate (FR-002). Tests: a fake session list; no run while sessions are open (SC-004); cancel; quit drops it. Mutation: skip the refusal of new sessions.
- [ ] T031 [US3] `harnesses.js` gate dialog: *Update when they end* (default) / *End N sessions and update* / Cancel, through `modal()`, plus the card's *Update waiting for N sessions* line with Cancel. Simulator driver with simulated sessions.

## Phase 6: US4 Failures (P2)

- [ ] T032 [US4] Advice per class in `harnesses.js` (admin: the command to copy, never an offer to elevate; in-use; managed; uac-cancelled; network; other with the last lines and the vendor page). Policy off: *Updates are managed by your organization*. Test: each fixture shows its message (SC-005).
- [ ] T033 [US4] Spec 076 hooks: one `updatePolicy()` function (allowInAppInstall, version range). It is a stub until 076's reader lands, then wired to it (FR-032, FR-175, FR-188). Test with a fake policy.

## Phase 7: US5 Announce once (P3)

- [ ] T034 [US5] The announce rule (plan D7, Q5 = B): badge on the card and the Settings entry, one toast per app and version, saved in `announcedVersions`; no toast when Settings > Agent apps is visible or for a failed check; no system notification. Tests: the same version on the next start gives no toast; a newer one gets a toast; a failure gives no toast. Mutation: compare against the installed version instead of the announced one. Driver: badge and toast.

## Phase 8: Docs and polish

- [ ] T035 [P] README (*Safety model*, *Agent apps*): the start check, the FR-017 endpoint table, the policy switch, `codex update` undocumented, no sudo. `changelog.d/081-cli-updates.md`. Retake the linked Agent apps screenshots with `npm run shots:docs -- --only <setup driver>`.
- [ ] T036 [P] `docs/agent-notes.md`: vendor updater facts with evidence once T040-T042 run.
- [ ] T037 `npm run typecheck && npm run build && npm test`; run `docs/review-checklist.md`; `/speckit-converge`.

## Phase 9: Real-machine checks (owner-approved; each changes an installed app; 0 AI credits)

- [ ] T040 Linux (this machine): record `claude --version`, `copilot --version` (whether it contacts the network), `npm view`, and a `claude update` on the native install. Replace fixtures with the recorded shapes (masked) and update the `[KNOWN GAP]`s.
- [ ] T041 Windows (CI runner or a teammate's machine): winget `list --upgrade-available` tables (record the column layout), an update with a running `codex.exe` (in-use class), and a UAC-cancelled case if possible.
- [ ] T042 macOS (the owner's Mac, Homebrew cask Codex): `brew info` and `brew outdated` with `HOMEBREW_NO_AUTO_UPDATE=1` (confirm no network), `brew upgrade --cask codex`, and `codex update` behaviour on a cask install.

## Dependencies

- T001-T007 come before every story.
- US1 (T010-T014) comes before US2 (T020-T023).
- US3 (T030-T031) needs T020-T021.
- US4 and US5 need US1.
- Docs (T035-T037) come last.
- T040-T042 run any time after T010 with owner approval.
- MVP: US1, US2 and US3.

## FR coverage

- FR-001: T003, T013
- FR-002: T010, T013
- FR-003: T011
- FR-004: T004, T006, T010
- FR-005: T004
- FR-006: T003
- FR-007: T013
- FR-008: T020, T022
- FR-009: T020, T021
- FR-010: existing runner, T021
- FR-011, FR-012: T022
- FR-013: T030, T031
- FR-014: T005, T032
- FR-015: withdrawn
- FR-016: T034
- FR-017: T006, T035
- FR-018: T020, T021
- FR-019: T003, T041, T042
- FR-020: T014
- FR-021: T001, T040-T042
- SC-001..SC-007: T013, T011, T023, T030, T032, T013, T013

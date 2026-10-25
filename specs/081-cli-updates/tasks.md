---
description: "Tasks for spec 081: agent-app updates"
---

# Tasks: Agent-app updates

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Tests**: required (constitution VII). Every new rule gets a unit test, plus a planted mutation that the test catches, named in the PR.

**Format**: `[ID] [P?] [Story] Description`. **[P]** means the task can run in parallel with others (different files).

Nothing here is started. The owner starts implementation after review.

Revised on 2026-10-24 after Paco's review of #663. Q3, Q6 and Q7 were answered on 2026-10-25 and are folded in.

## Phase 1: Setup

- [ ] T001 [P] Fixtures in `scripts/fixtures/updatecheck/`, each with a header naming its source (`read:` doc page, `real:` recorded run):
  - `npm view <pkg> version --json` for the three packages, plus an npm error whose text contains `node v22.11.0`;
  - `brew info --cask --json=v2` (with and without `outdated`) and `brew outdated --cask --json=v2` for `codex`, `claude-code`, `claude-code@latest` and `copilot-cli` (`auto_updates`);
  - the GitHub `Location` headers (`real:` 2026-10-24: `rust-v0.164.0`, `v1.0.103`), plus a **realistic-size** body (about 570 KB) to prove it is never read;
  - the two Claude channel texts (`real:` 2026-10-24);
  - winget tables, including the "source terms not accepted" answer, as placeholders marked "replace with a recorded run" (T041);
  - Copilot CLI copies on disk (npm `package.json`, Caskroom folder, `~/.copilot/pkg/<ver>`).
- [ ] T002 [P] Add `test:updatecheck` to `package.json` (append to `test:serial`, keep `main`'s list).

## Phase 2: Foundational (blocks every story)

- [ ] T003 `src/shared/updatecheck.ts` `sourceOf(realPath, platform, env)` (plan D2), on top of `routeOwning`:
  - npm (same Node bin folder, prefix match);
  - brew (prefix plus cask from `Caskroom/<cask>/`);
  - winget;
  - official (Codex `packages/standalone`, `~/.copilot/pkg`, `~/.local/share/claude/versions`);
  - outside (`/usr/bin` distro, `/snap/`, Scoop).

  Uses `path.win32` and `path.posix`, case-insensitive on Windows and macOS. Test a matrix per OS, a symlinked `/usr/local/bin` on an Intel Mac, look-alike paths and hostile long paths. Mutations: drop the realpath requirement for `/usr/local`; compare case-sensitively on win32.
- [ ] T004 `src/shared/updatecheck.ts`: the check argv table (plan D3: `--no-update-notifier`, no winget agreement flags, a second brew run only when needed), the structured-field parsers through `parseVersionField`, and the decision.
  - The compare is stable-first and pre-release-aware.
  - A source behind the installed version gives no Update.
  - Tests: every T001 fixture, hostile output (huge, markup, `__proto__` JSON, a version with HTML), a pre-release installed, the downgrade case.
  - Mutations: accept a 65-character version; parse the npm error line as a version; add `--accept-source-agreements` to the background check.
- [ ] T005 `src/shared/updatecheck.ts` `classifyFailure` (plan D8, FR-014): admin, in-use, managed (policy, winget refusal, recorded vendor text only), `vendor-up-to-date` (`claude update` "up to date", never *Managed*), uac-cancelled, network, other. Test each class with fixtures per OS. Mutations: drop the Windows `EBUSY` pattern; classify "Claude is up to date" as managed.
- [ ] T006 `src/shared/updatecheck.ts` `LOOKUPS` and `src/main/netget.ts` `LookupGet` over Electron **`net.request`** on the app session (FR-026, plan D4): `redirect: 'manual'`, `credentials: 'omit'`, `useSessionCookies: false`, `User-Agent: AgentDurbar`, 10 s, and a capped body reader (64 bytes for the Claude channels). For GitHub, read the `redirect` event's `statusCode` and `redirectUrl`, then `abort()`, never `followRedirect()`. `net.fetch` is not used ("Redirect was cancelled" in Electron 44, `real:` 2026-10-25).
  - The fake models `net.request` as an event emitter (`redirect`, `response`, `error`).
  - Tests: a look-alike host, an off-list path, a redirect URL to another host or path, a `response` with no redirect, the 570 KB body never read (the request is aborted), an oversized channel body.
  - Mutations: call `followRedirect()`; allow any path on `github.com`; skip `abort()`.
- [ ] T007 `src/main/settings.ts`: `announcedVersions` (an allowed app id and a valid version; anything else dropped) and `checkUpdatesAtStart` (a boolean, on by default per Q6 = A, only `false` written). Test a hostile matrix.
- [ ] T008 Strict versions (FR-005, SC-008):
  - **The detection path is fixed by PR #698** (spec 012 T133, FR-039 delta, `Closes #664`): a bounded `parseVersion` on the first line, cut to 200 characters, that rejects error prose and tokens cut off at the cap, with mutations and a CPU backstop. Spec 081 reuses it and does not reimplement it. If #698 has not merged when this task starts, wait for it or rebase onto it. If it was changed or closed, re-read spec 012 and only then decide.
  - **New here:** `parseVersionField` in `src/shared/updatecheck.ts`, for the structured fields that #698 does not cover (npm JSON, brew JSON, the redirect tag, the Claude channel text). A field **longer than 64 characters is rejected, never cut**; otherwise it is matched against `^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-[0-9A-Za-z.-]{1,40})?$`. Reuse #698's bounded token pattern if it fits instead of keeping a second one, and name the shared constant in the PR.
  - Tests for the field parser: 64 KiB of digits within a CPU-time limit (`process.cpuUsage`), the npm error line, `rust-v0.164.0`, `v1.0.103`, `2.1.308`, and a 65-character version.
  - Mutations: an unanchored field pattern; cutting to 64 instead of rejecting. A 65- to 71-character version with a valid-looking pre-release must be rejected.
- [ ] T009 `src/adapters/detect.ts` `nodeExec`: an `env` option (merged for that child only) and a tree kill on timeout (Windows `taskkill /T /F /PID` from `%SystemRoot%\System32`; POSIX process group). Test with a fake `execFile`/`spawn` that a timeout kills the tree and that the env reaches only that child. Mutation: kill only the direct child.

## Phase 3: US1 See whether an app is out of date (P1, MVP)

- [ ] T010 [US1] `src/main/updatecheck.ts` `UpdateChecker`:
  - one app at a time, a 30 s limit;
  - `nodeExec` with env for tools (brew `HOMEBREW_NO_AUTO_UPDATE=1`, npm `npm_config_update_notifier=false`), `LookupGet` for official;
  - in-memory results with monotonic and wall times;
  - a manual check during the start check joins it;
  - the Copilot CLI version read from the copy's files, **never by running `copilot`** (FR-002);
  - Claude records both channels, and `stable` decides (Q7 = C): `update-available` only below `stable`, plus `newerOnLatest` for the quiet note. Test the three positions (below `stable`, between, at or above `latest`). Mutation: decide by `latest`.

  Test with a fake exec and fake fetch: one run per app (two for brew at most), no doubling, results kept, no call for an `outside` source, and no spawn of `copilot`.
- [ ] T011 [US1] Start scheduling (plan D6, FR-003, FR-022): `main.ts` calls `scheduleStart()` after the first `did-finish-load` and after `adaptersInfo`. It is skipped under the simulator, when the user's switch is off, when policy is unreadable (fail closed), or when policy disallows (`allowInAppInstall: false`, `features.agentAppUpdateCheck: false`, `updates.mode: "off"`; Q6 = A).
  - Test with a runner-call counter: one check per installed app per start; none from opening Settings or starting a session; none with the switch off, any of the three policy keys off, or the policy unreadable (SC-002); a new install checks (the default is on).
  - Mutation: treat unreadable as allowed.
- [ ] T012 [US1] IPC `harness:updates` (get the kept results, or `'check'` to check anew) and the event `harness:updatesChanged`. `preload.ts` gets `harnessUpdates` and `onHarnessUpdates`, and `scripts/test-ipc-channels` is updated. Sender-frame check, as the other harness calls have.
- [ ] T013 [US1] `src/renderer/harnesses.js` card:
  - *Installed x · <source>*, and *Latest y (as Homebrew knows it)* or *latest a · stable b* for Claude native, with the quiet note *A newer latest-channel build exists* when `newerOnLatest` is set (Q7 = C);
  - the check time and a chip with a word;
  - *Check for updates*, plus *Check* on each card;
  - the switch *Check for updates when Durbar starts* with its note (*Durbar checks for updates each time it starts*);
  - with `features.agentAppUpdateCheck: false` or `updates.mode: "off"`: the button, *Check*, the *Latest* lines and the switch are hidden with *Turned off by your organization* (076 FR-158); with `allowInAppInstall: false`: the button stays, read-only (FR-022);
  - the Copilot runtime line plus the CLI line;
  - every value escaped (test: a hostile version and source).

  Simulator driver `scripts/shots-081-updates.js`: waits on conditions, checks SC-007 (no delay to the office), and takes screenshots `081-updates-*` at 1440x900 and 1280x800.
- [ ] T014 [US1] `src/renderer/sim.ts`: canned results (up to date, update available, could-not-check, outside, both Claude channels) and no network (FR-020). `test:simguard` still passes.

## Phase 4: US2 Update from the owning source (P1, MVP)

- [ ] T020 [US2] `src/shared/harnesssetup.ts`:
  - npm and winget update argv pinned to the checked version (FR-023);
  - Copilot brew adds `--greedy`, and `claude-code@latest` updates that cask;
  - own-updater plans `claude update` and `copilot update`, plus `codex update` (undocumented) only for an official standalone Codex CLI (Q3 = C, limited). `isOfficialCodex` in `src/shared/updatecheck.ts` is the single place for the standalone rule (plan D3): `<CODEX_HOME>/packages/standalone/releases/` on every OS. The Windows `install.ps1` folder, every other Codex copy, and the fallback use the 060 installer plan with `CODEX_NON_INTERACTIVE=1`;
  - for an update, only the owning route is shown, with the others behind *Show other ways* (FR-008).

  Extend `test-harnesssetup`, and test `isOfficialCodex` in `test-updatecheck`:
  - argv per source and OS, owning route only, the pin present;
  - official versus non-official Codex: the standalone root on each OS, the Windows `Programs\OpenAI\Codex\bin` folder (not official, goes to the 060 route), a look-alike `…/packages/standalonex/`, a link that leaves the root, a relative `CODEX_HOME`, a world-writable folder, a missing `codex-cli` label, npm and brew copies (own route, never `codex update`).

  Mutations: offer npm first for a brew copy; drop the pin; accept a prefix match without a path separator; skip the label check.
- [ ] T021 [US2] `src/main/harnesssetup.ts`:
  - `prepare` accepts an own-updater plan (the app's binary, real path, `trustedPath`);
  - the `isRoot` refusal covers own updaters and every official installer (FR-025);
  - Codex's official installer run sets `CODEX_NON_INTERACTIVE=1` in that child's environment only;
  - `codex update` gets the plain-words confirmation with the exact `CODEX_UPDATE_COMMAND` for the OS (Windows: `powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex"`), that the installed Codex decides what runs, and *Durbar cannot see or check that script*;
  - the `codex update` child: `CODEX_MANAGED_BY_NPM`, `_PNPM`, `_BUN` and `_VITE_PLUS` removed from its environment, a fixed system `PATH` (POSIX `/usr/bin:/bin:/usr/sbin:/sbin`; Windows from an absolute `SystemRoot` only), and a fresh 0700 temp working folder deleted afterwards;
  - the fallback: `finish` reports `fallback: 'official'` for an unknown subcommand, "Could not detect the Codex installation method", or another failing exit that is not in-use or managed, and the window offers the 060 route with its own confirmation;
  - the confirmation shows the target version, pinned or not, the integrity line (FR-024) and Copilot's sign-in note.

  Tests:
  - root refused for `claude update`, `copilot update`, `codex update` and Codex official;
  - the env var only on that child;
  - each fallback trigger offers the 060 route and never retries by itself;
  - in-use gives no fallback;
  - the confirmation text holds the exact command;
  - with each `CODEX_MANAGED_BY_*` set in Durbar's environment, the child has none;
  - the child's `PATH` is the fixed list even when the user's `PATH` has a folder with a fake `sh` or `curl`;
  - the working folder is the temp folder and is removed.

  Mutations: check `isRoot` only for `plan.script`; retry `codex update` automatically; drop the command from the confirmation; pass `CODEX_MANAGED_BY_NPM` through; inherit `PATH`.
- [ ] T022 [US2] Version drift and `max` (FR-023): a fresh check of that app before the confirmation; with a `max`, only pinnable routes, pinned and within range; a non-pinnable owning route gives the explanation. After the run, detection runs again, and the shadowing-copy message appears when relevant (FR-011). An `outside` copy gets a hint and no Update (FR-012). Test the decision table, including the source moving on between check and confirm. Driver: dialog, progress, new version.
- [ ] T024 [US2] Spec 060 delta (2026-10-25): `src/main/officialinstall.ts` downloads through `netget.ts` (`net.request` on the app session), so the update fallback follows the proxy and the OS certificates (076 FR-155, FR-156). It keeps the per-hop allow-list (each redirect checked in the `redirect` event before `followRedirect()`), the 3-redirect limit, the 1 MB cap, the 30 s limit and the private file. Extend `test-officialinstall` with the fake `net.request`: an off-list hop is refused before it is followed. Mutation: follow before checking.
- [ ] T023 [US2] SC-003: every path to `start` passes the native confirmation (own updater, Codex official, waiting update).

## Phase 5: US3 Open sessions (P1, MVP)

- [ ] T030 [US3] The update lock and gate (plan D5, FR-013):
  - `updateLock[kind]` is taken on *Update…*, before the count, and held to the finish;
  - the lock blocks `agents:create`, `agents:start`, resume, and an `agents:send` or scheduled prompt **only when it would start or resume a session** (held and marked *held: <app> is updating*); sends and scheduled prompts to sessions that are still open go through, so *Update when they end* can finish;
  - `{needsGate, busy, pendingPermissions, heldPrompts}`;
  - `wait` and `end` (`end` calls `stopTurnOp`, then `endSessionOp`);
  - count again after the confirmation;
  - release on finish, failure, cancel or quit;
  - Copilot CLI: no gate.

  Tests with a fake session list and schedules: a resume or scheduled prompt during the confirmation is blocked, and the re-count sends the dialog back; no run while sessions are open (SC-004); cancel releases. A send to a live session goes through while the update waits; a send that would resume an ended session is held. Mutations: take the lock after the count; skip the re-count; skip `stopTurnOp`; block sends to live sessions.
- [ ] T031 [US3] The gate dialog in `harnesses.js` uses the *End all sessions?* wording, through a helper shared with `app.js` `endAllSessions`. It adds pending permission requests and held prompts, and the card line *Update waiting for N sessions* with Cancel. Simulator driver with simulated sessions.

## Phase 6: US4 Failures (P2)

- [ ] T032 [US4] Advice per class in `harnesses.js`:
  - admin: the command to copy, never an offer to elevate;
  - in-use, managed, uac-cancelled, network;
  - `vendor-up-to-date`: *Claude Code says it is up to date on its channel*, with no toast;
  - other: the last lines and the vendor page.

  Policy off shows *Updates are managed by your organization*. Test that each fixture shows its message (SC-005).
- [ ] T033 [US4] Spec 076 hooks: `updatePolicy()` returns `none`, `ok` or `unreadable` with `allowInAppInstall`, `features.agentAppUpdateCheck`, `updates.mode` (`off` stops the start check, Q6 = A) and the range. It is a stub (`none`) until 076's reader lands, then wired in (FR-022, FR-032, FR-175, FR-188). Test with a fake policy, including `unreadable`, which stops the start check.

## Phase 7: US5 Announce once (P3)

- [ ] T034 [US5] The announce rule (plan D7, Q5 = B):
  - a badge on the card and the Settings entry;
  - one toast per app and version, saved in `announcedVersions`;
  - no toast when Settings > Agent apps is visible, for a failed check, for `vendor-up-to-date`, or for a Claude `newerOnLatest` note (Q7 = C);
  - no system notification.

  Tests: the same version on the next start gives no toast; a newer one gets a toast. Mutation: compare against the installed version instead of the announced one. Driver: badge and toast.

## Phase 8: Docs and polish

- [ ] T035 [P] README (*Safety model*, *Agent apps*): the start check and its switch, the FR-017 table (IP, time, User-Agent, npm's token and notifier, brew runs), the policy keys, the integrity per updater (FR-024), no root and no auto-accepted winget terms. Also `changelog.d/081-cli-updates.md`. Retake the linked Agent apps screenshots with `npm run shots:docs -- --only <setup driver>`.
- [ ] T036 [P] `docs/agent-notes.md`: add an entry saying that `codex update` is curl-to-shell (used only for the official Codex CLI, Q3), that GitHub `releases/latest` is too big and the `Location` header gives the tag, and that `copilot` may update itself when started. Add the vendor updater facts with evidence once T040-T042 run. Spec 076: add `features.agentAppUpdateCheck` to its feature list (FR-158, FR-159), and update **FR-174** so `updates.mode: "off"` also turns off spec 081's start check and its *Check for updates* (Q6 = A), in this PR or in 076's.
- [ ] T037 `npm run typecheck && npm run build && npm test`; run `docs/review-checklist.md`; `/speckit-converge`.

## Phase 9: Real-machine checks (owner-approved; each changes an installed app; 0 AI credits)

- [ ] T040 Linux (this machine): record `claude --version`, `npm view` with `--no-update-notifier` (and confirm one request only), and a `claude update` on the native install (its "up to date" text and, if it can be produced safely, the `DISABLE_UPDATES` text). Replace fixtures with the recorded shapes (masked) and update the `[KNOWN GAP]`s.
- [ ] T041 Windows (CI runner or a teammate's machine): the winget `list --upgrade-available` tables (column layout, the terms-not-accepted answer); `winget upgrade --version`; an update with a running `codex.exe` (in-use class); the `npm.cmd` tree kill; a UAC-cancelled case if possible.
- [ ] T042 macOS (the owner's Mac, Homebrew cask Codex): `brew info` and `brew outdated` with `HOMEBREW_NO_AUTO_UPDATE=1` (confirm no network, for example with a proxy log); whether `brew info --json=v2` carries `outdated`; `brew upgrade --cask codex`.

## Dependencies

- T001-T009 come before every story.
- US1 (T010-T014) comes before US2 (T020-T023).
- US3 (T030-T031) needs T020-T021.
- US4 and US5 need US1.
- Docs (T035-T037) come last.
- T040-T042 run any time after T010, with owner approval.
- MVP: US1, US2 and US3.

## FR coverage

- FR-001: T003, T013
- FR-002: T010, T013
- FR-003: T011
- FR-004: T004, T006, T010
- FR-005: T004, T008
- FR-006: T003
- FR-007: T013
- FR-008: T020, T022
- FR-009: T020, T021
- FR-010: T009, T021
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
- FR-022: T007, T011, T013, T033
- FR-023: T020, T022
- FR-024: T021, T035
- FR-025: T021
- FR-026: T006, T024
- SC-001: T013
- SC-002: T011
- SC-003: T023
- SC-004: T030
- SC-005: T032
- SC-006: T013
- SC-007: T013
- SC-008: T008

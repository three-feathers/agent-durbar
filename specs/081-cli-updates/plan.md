# Implementation Plan: Agent-app updates

**Branch**: `081-cli-updates` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

**Input**: Feature specification from `specs/081-cli-updates/spec.md`, with the owner's answers (Clarifications, 2026-10-23: Q1 = C, Q2 = A, Q4 = A, Q5 = B) and Paco's review of #663 (2026-10-24, 15 items). Q3 is asked again, and Q6 and Q7 are open. Where the plan depends on them it says so, and it builds the spec's current default.

## Summary

For each agent app, show the installed version, its install source and the latest version that source offers. Offer **Update…** when a newer version exists. A background check runs once at every Durbar start, after the office is shown, and again on *Check for updates*.

The update reuses spec 051's runner and native confirmation, and its route order puts the owning source first (`routeOwning`). For a vendor-installer copy it runs the app's own documented updater (`claude update`, `copilot update`). Codex runs spec 060's checked installer with `CODEX_NON_INTERACTIVE=1`; `codex update` is not used, because it is curl-to-shell, and Q3 is pending. Versions are pinned where the route allows, and checked again before the confirmation. An update lock, held from the count to the finish, waits for or ends open sessions of that app. Failures are classified and come with advice. A new version gets a badge, plus one toast per app and version.

This adds no parallel installer, runner, dialog or IPC family. It adds a pure *version-check* module and a main-side *checker* beside `HarnessSetup`. Spec 051's channels gain one channel and one event, and the existing `harness:run` gains a gate argument.

## Technical Context

- **Language and runtime**: TypeScript in `src/main`, `src/shared` and `src/adapters`. Plain JS in `src/renderer` (`harnesses.js`, `screens.js`). Electron main and preload.
- **Dependencies**: none new. Child processes use Node's `child_process.execFile` through the existing `nodeExec` (checks) and `HarnessSetup` (updates). Durbar's own version lookups use Electron `net.fetch` on the app session, so they follow the system or organization proxy and the OS certificate store (spec 076 FR-155, FR-156). They are behind an injected `LookupGet` type with `redirect: 'manual'` and `credentials: 'omit'`, and the FR-026 allow-list. Node's `https.get` (`officialinstall.ts`) is not used for these lookups.
- **Storage**: `SettingsStore` (`src/main/settings.ts`) gains `announcedVersions: Record<'claude'|'codex'|'copilot', string>` (version strings only) and `checkUpdatesAtStart: boolean` (FR-022; default per Q6). Results stay in memory.
- **Testing**: new `scripts/test-updatecheck.ts` (pure parsers, source detection, decision rules, announce rule, failure classes, start scheduling with fakes). It extends `scripts/test-harnesssetup.ts` (update argv per source with pinning, the root refusal for every updater, the update lock and session gate). A simulator driver `scripts/shots-081-updates.js` covers the card, dialog, badge and toast. All of this runs with 0 AI credits and no network: `nodeExec` and `LookupGet` are injected.
- **Platforms**: Windows, macOS and Linux. Path logic is pure, with `path.win32` and `path.posix` and an injected environment, the same as `routeOwning` and `candidates`.
- **Performance**: the start check must not delay first paint (SC-007). It runs one app at a time, with a 30 s limit each and output capped at 64 KiB. Per app and start it makes one npm or winget run, up to two local brew runs, one header-only request (Codex, Copilot), or two tiny requests (the Claude channels). Version parsing is linear and bounded (FR-005); a 64 KiB hostile answer is tested against a CPU-time limit.
- **Constraints**: no shell. Argv comes only from fixed tables. The window sends an app id and a route index, nothing more. No sudo or elevation. Output is masked (`redact()` plus the OAuth mask), and nothing is logged.

## Constitution Check

| Principle | How this plan complies |
|---|---|
| I Spec Kit | Spec, plan and tasks come before any `src/` change. Q1-Q5 are answered by the owner and recorded. |
| II Adapter boundary | Version, source and update knowledge for the CLIs lives in `src/shared/updatecheck.ts` (pure) and `src/main/updatecheck.ts`, beside the existing `harnesssetup` modules. The renderer sees only app ids, version strings, the source label and states. No vendor event names are involved. The bundled Copilot runtime stays pinned (FR-002). |
| III Safe by default | Nothing updates without the native confirmation (SC-003), including a waiting update, which is confirmed again when it runs. Argv arrays only, `shell: false`. No curl-to-shell: `codex update` is not used. Fixed hosts and paths for the lookups, with no body read for GitHub. No credentials from Durbar: `.npmrc` is never read (npm may send its token; FR-017 says so), and `copilot` is never run to read a version. Every vendor updater is refused as root (FR-025). winget terms are never auto-accepted in the background. Output is masked. The start check is the owner's decision (Q1 = C), with a user switch and an organization key that fails closed (FR-022), and FR-017 lists everything it reveals. |
| IV No AI credits | Checks and updates call package managers and the vendors' release endpoints, never a model. Tests use fixtures. A real update is a separate, owner-approved task (T040). |
| V Calm UI | One status line and a chip with a word on each card. A quiet badge. One toast per new version only. The 1440x900 and 1280x800 screenshots are part of the tasks. |
| VI Platforms | Per-OS routes. Windows locked files are handled through the session gate and the failure classes. Real-machine checks are `[KNOWN GAP]` until T040, T041 and T042 record them. |
| VII Quality gates | Unit tests for every new rule, with mutations listed in the tasks. A simulator driver. typecheck, build and test. |
| VIII Honest limits | Homebrew data is labelled *as Homebrew knows it*. winget fixtures wait for a recorded run. The `downloads.claude.ai` channel files are not a documented API (D4). Integrity is stated per updater, with *unconfirmed* where the docs say nothing (FR-024). |

No violations, so Complexity Tracking is empty.

## Design

### D1 Modules (reuse first)

| Existing code | Reused for | Change |
|---|---|---|
| `src/adapters/detect.ts` `parseVersion`, `compareVersions`, `detectBinary`, `candidates`, `displayPath`, `nodeExec` | installed version, version compare, finding the tool, running checks | `parseVersion` is replaced by the bounded first-line parse of FR-005, and `parseVersionField` (strict, structured field) is added (T008, issue #664). `nodeExec` gains an `env` option, merged over `process.env` for that child only (`HOMEBREW_NO_AUTO_UPDATE`, `npm_config_update_notifier`). It also gains a **tree kill** on timeout: on Windows `taskkill /T /F /PID` from `%SystemRoot%\System32`, as `HarnessSetup` already does, because an `npm.cmd` run goes through `cmd.exe` and `execFile`'s timeout kills only `cmd.exe`; on POSIX the process group. A pre-release-aware compare goes in `updatecheck.ts` on top of `compareVersions`. |
| `src/shared/harnesssetup.ts` `ROUTES`, `updatePlans`, `routeOwning`, `runRequest`, `lastLines`, `stripAnsi` | update argv per source, owning source, request validation, output | `routeOwning` learns Codex's `packages/standalone`, `~/.copilot/pkg`, Scoop (named, no route) and Linux `/usr/bin` / `/snap` (outside). It returns the cask name too (`claude-code` vs `claude-code@latest`). npm and winget updates take a checked version (pinned, FR-023). Copilot's brew update gains `--greedy`. Claude and Copilot official routes gain an *own updater* plan (`claude update`, `copilot update`). Codex's stays the 060 installer. winget's agreement flags are kept off checks (FR-004). |
| `src/main/harnesssetup.ts` `HarnessSetup.plans`, `prepare`, `start`, `cancel`, `trustedPath`, `busy`, `isRoot` | the whole update run and its native confirmation | `prepare` accepts an own-updater plan: the binary is the app itself (real path, `trustedPath`) with fixed args. The `isRoot` refusal covers own updaters and every official installer (FR-025). The confirmation text shows the target version, whether it is pinned, the integrity line (FR-024) and, for `copilot update`, that it uses the GitHub sign-in. Before the confirmation, `prepare` calls the checker for a fresh check of that app (FR-023). |
| `src/main/officialinstall.ts` allow-list style (`allowedScriptUrl`) | the pattern for the lookup allow-list | none to the file. The lookup allow-list (`LOOKUPS`, FR-026) lives in `src/shared/updatecheck.ts` with the same exact-host and path-prefix shape. The fetch is Electron `net.fetch` in `src/main/updatecheck.ts`. |
| `src/main/ipc/harness.ts`, `src/preload/preload.ts` | channels | new `harness:updates` (get the kept results, optionally `'check'`), the event `harness:updatesChanged`, and the op `'update'` on `harness:run` gaining the session-gate answer (D5). `scripts/test-ipc-channels` lists them. |
| `src/renderer/harnesses.js` cards, plan dialog, progress modal | status line, chip, *Check for updates*, the start-check switch, Update…, session dialog | extended in place. No new dialog component: it uses `modal()`, the existing plan dialog, and `askDialog` with the *End all sessions?* wording from `app.js` `endAllSessions`, moved into a shared helper both use (FR-013). |
| `src/renderer/screens.js` Settings entry | badge on *Settings > Agent apps* | a badge count from `harness:updates`. |
| renderer `toast()` (`app.js`) | the one toast per new version | none. |
| `SettingsStore` | `announcedVersions` | new getter and setter with validation (an allowed app id and a version that matches `parseVersion`, at most 64 characters). |
| `agentops.ts` `stopTurnOp`, `endSessionOp`, main's `agents` map, the schedules runner (spec 044) | counting, interrupting and ending a given app's sessions; holding scheduled prompts | a small `sessionsOf(adapterId)` helper in main. "End N sessions" calls `stopTurnOp`, then `endSessionOp`, for each (`endSessionOp` alone does not interrupt). The update lock (D5) is checked in the start, resume and send paths and in the schedules runner. |
| spec 076 policy reader (when built) | `allowInAppInstall`, `features.agentAppUpdateCheck`, `updates.mode` (Q6), the version range | read through one function `updatePolicy()` that returns `{state:'none'|'ok'|'unreadable', ...}`. `unreadable` turns the start check off (fail closed, FR-022). Until 076 lands it returns `none` (`[KNOWN GAP]`, T033 wires it in). |

New files:
- `src/shared/updatecheck.ts` (pure):
  - the source descriptor from a real path and the platform, and the check argv per source;
  - the `LOOKUPS` allow-list, plus the anchored `Location` patterns for the GitHub tags (`/openai/codex/releases/tag/rust-v<ver>`, `/github/copilot-cli/releases/tag/v<ver>`);
  - structured-field parsers for `npm view --json`, `brew info --json=v2` and `brew outdated --json=v2`, the winget table, and the Claude channel text, all through `parseVersionField` (FR-005);
  - the Copilot CLI version from the copy's files (FR-002);
  - the decision (`up-to-date`, `update-available`, `could-not-check`, `outside`), the pinning and `max` filter (FR-023), the announce rule, the failure classifier (FR-014, *Managed* only on vendor text) and the policy filter (FR-022).
- `src/main/updatecheck.ts`: `UpdateChecker`, with the start scheduling, the queue (one app at a time), the in-memory results, the `net.fetch` lookups, the fresh check before a confirmation, and change events to the window.
- `scripts/test-updatecheck.ts`, `scripts/fixtures/updatecheck/*` (outputs per source and OS, with where each one came from).

### D2 Source detection

`sourceOf(realPath, platform, env)` returns one of:
- `{kind:'npm', tool:<npm path in the same Node bin folder, else a prefix match>}`
- `{kind:'brew', prefix, cask}`
- `{kind:'winget', id}`
- `{kind:'official', app}`
- `{kind:'outside', hint?: 'distro'|'snap'|'scoop'}`

It reuses `routeOwning` for the kind and adds the tool path, prefix and cask from the path's own components (`Caskroom/<cask>/<ver>/`). Symlinks are resolved first: `/usr/local/bin` on an Intel Mac counts as Homebrew only if the real path is under `Caskroom` or `Cellar` (research R5).

### D3 Check and update argv (fixed tables)

- **Check**:
  - npm: `['view', pkg, 'version', '--json', '--no-update-notifier']`, with env `npm_config_update_notifier=false`.
  - brew: `['info', '--cask', '--json=v2', cask]` with env `HOMEBREW_NO_AUTO_UPDATE=1`. Only when that answer has no `outdated` field, a second run `['outdated', '--cask', '--json=v2', ...(greedy ? ['--greedy'] : []), cask]`.
  - winget: `['list', '--id', id, '-e', '--upgrade-available', '--source', 'winget']`, **with no agreement flags**. An explicit check adds `--accept-source-agreements` only after the user's OK in the terms note.
  - official: `LOOKUPS` (D4, FR-026).
- **Update**:
  - npm: `['install', '-g', pkg + '@' + checked, '--no-update-notifier']`.
  - winget: `['upgrade', '--id', id, '-e', '--source', 'winget', '--version', checked, ...agreementAfterNote]`.
  - brew: the existing `ROUTES[*].update` (plus `--greedy` for `copilot-cli`).
  - Own updaters: `['update']` for `claude` and `copilot` only, run as the found binary of that copy (its real path, `trustedPath`, refused as root).
  - Codex official: the existing spec 060 plan (checked download, private file, size cap, root refusal) with `CODEX_NON_INTERACTIVE=1` in that child's environment only.
  - `codex update` is not in the table (FR-009, Q3 pending). If the owner picks Q3 = C, it becomes an own-updater plan with the facts shown in the confirmation, and T021 changes.

### D4 Lookups through Chromium

`net.fetch(url, {method: 'HEAD' for GitHub / 'GET' for Claude, redirect: 'manual', credentials: 'omit', headers: {'User-Agent': 'AgentDurbar'}, signal: 10 s})` on the app's session.

- **GitHub**: the status must be 301/302/303/307/308, and `Location` must match the anchored pattern exactly (`https://github.com/openai/codex/releases/tag/rust-v` plus the version). The body is never read.
- **Claude**: both channel files, with the body read up to 64 bytes through a capped reader. Each passes `parseVersionField`.

Which file decides *Update available* is Q7. Until it is answered, the checker records both, and the decision function takes the channel as a parameter, so Q7's answer is a one-line choice plus its test. `[KNOWN GAP]`: the channel files are not a documented API.

### D5 Update lock and session gate (Q2 = A, review item 10)

1. `harness:run(kind, 'update', idx, gate?)`. Main first takes `updateLock[kind]`, and returns `{busy}` if it is already held. The lock blocks every start, resume and send of that adapter (`agents:create`, `agents:start`, resume, `agents:send`) and the schedules runner. A due scheduled prompt is held and marked *held: <app> is updating* on its card.
2. Main counts `sessionsOf(adapter)`, where `claude` and `codex` map to their adapters and the `copilot` CLI has none:
   - `0`: go on to step 3.
   - more than 0 and no `gate`: return `{needsGate: n, busy: m, pendingPermissions: p, heldPrompts: q}` and keep the lock. The window shows the gate dialog with the shared *End all sessions?* wording.
   - `gate:'wait'`: keep the lock as a waiting update. When the count reaches 0, go on to step 3.
   - `gate:'end'`: for each session `stopTurnOp`, then `endSessionOp` (pending permission requests are denied by ending), then step 3.
   - Cancel: release the lock.
3. A fresh check (FR-023), then `prepare` and the native confirmation, then **count again**. If more than 0, back to step 2 (the dialog returns). Otherwise `start`.
4. Release the lock on finish, failure, cancel, or quit. Held scheduled prompts then follow spec 044's own rules.

A waiting update lives in memory only.

### D6 Start check (Q1 = C)

`UpdateChecker.scheduleStart()` is called from main after the window's first `did-finish-load` and after `adaptersInfo` resolves. A `setImmediate` chain then runs one app at a time. It is skipped when `SIMULATOR` is set (canned answers), when the user's `checkUpdatesAtStart` is off, when `updatePolicy()` is `unreadable` (fail closed), or when it says `allowInAppInstall: false` or `features.agentAppUpdateCheck: false` (and `updates.mode: 'off'`, if Q6 says so). Results go to memory, and `harness:updatesChanged` is sent. Errors set `could-not-check` with a short masked reason, and nothing else happens. A manual *Check for updates* while the start check runs joins it rather than doubling it.

### D7 Announce (Q5 = B)

When a result is `update-available` and its version differs from `announcedVersions[app]`, main sends `announce` with the change event, unless the window reports that Settings > Agent apps is visible. Main then saves the version. The renderer shows `toast()` once and the badge (`hs-badge`, with a word, not only a colour).

### D8 Failure classes (FR-014)

`classifyFailure({code, errorCode, text, platform, source})` returns one of `admin`, `in-use`, `managed`, `uac-cancelled`, `network` or `other`. `managed` comes only from Durbar's policy, a winget or Group Policy refusal, or a vendor message recorded in a fixture. `claude update` saying "up to date" is its own non-error result, `vendor-up-to-date` (FR-014). Each class is tested against captured fixtures. Patterns are matched case-insensitively on the masked text, and the raw output is never kept. The advice strings live in the renderer table next to the existing ones.

## Project Structure

```text
specs/081-cli-updates/
├── spec.md
├── research.md
├── plan.md        (this file)
└── tasks.md

src/shared/updatecheck.ts          (new, pure)
src/shared/harnesssetup.ts         (routeOwning details, --greedy, own-updater plans)
src/main/updatecheck.ts            (new: UpdateChecker)
src/main/harnesssetup.ts           (own-updater plan, codex fallback, session gate hook)
src/main/settings.ts               (announcedVersions)
src/main/ipc/harness.ts            (harness:updates, gate arg)
src/main/main.ts                   (start scheduling, sessionsOf, update lock in start/resume/send)
src/main/schedules.ts              (hold due prompts while an update lock is held)
src/adapters/detect.ts             (bounded parseVersion, parseVersionField, nodeExec env and tree kill; #664)
src/preload/preload.ts             (harnessUpdates, onHarnessUpdates)
src/renderer/harnesses.js          (status line, chip, Check for updates, gate dialog, badge, toast)
src/renderer/screens.js            (Settings entry badge)
src/renderer/sim.ts                (canned check results and update run)
scripts/test-updatecheck.ts        (new)
scripts/test-harnesssetup.ts       (extended)
scripts/fixtures/updatecheck/      (new)
scripts/shots-081-updates.js       (new simulator driver)
```

**Structure decision**: the feature lives beside spec 051's harness setup, with the pure logic in `src/shared` and the I/O in `src/main`, as `harnesssetup` already does.

## Docs

- README *Safety model* and *Agent apps*: the start check and its switch, what it contacts and reveals (the FR-017 table), how organization policy turns it off, the integrity line per updater (FR-024), and that Durbar never runs updaters as root or auto-accepts winget terms.
- `specs/012-*/spec.md`: a dated delta for the `parseVersion` fix (#664).
- `docs/agent-notes.md`: an entry for each vendor's updater behaviour once it is verified on a real machine.
- `changelog.d/081-cli-updates.md`.
- Screenshots: Settings > Agent apps (cards with a status line), the session gate dialog and the badge, at 1440x900 and 1280x800. `npm run shots:docs -- --only <setup driver>` retakes the linked Agent apps pictures.

## Complexity Tracking

None.

# Implementation Plan: Agent-app updates

**Branch**: `081-cli-updates` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

**Input**: Feature specification from `specs/081-cli-updates/spec.md`, with the owner's answers to Q1-Q5 (Clarifications, 2026-10-23: Q1 = C, Q2 = A, Q3 = C, Q4 = A, Q5 = B).

## Summary

For each agent app, show the installed version, its install source and the latest version that source offers. Offer **Update…** when a newer version exists. A background check runs once at every Durbar start, after the office is shown, and again on *Check for updates*.

The update reuses spec 051's runner and native confirmation, and its route order puts the owning source first (`routeOwning`). For a vendor-installer copy it runs the app's own updater: `claude update`, `copilot update`, or Codex's undocumented `codex update`, which falls back to the installer. Open sessions of that app are waited for or ended first. Failures are classified and come with advice. A new version gets a badge, plus one toast per app and version.

This adds no parallel installer, runner, dialog or IPC family. It adds a pure *version-check* module and a main-side *checker* beside `HarnessSetup`. Spec 051's channels gain two new channels and one new op on the existing `harness:run`.

## Technical Context

- **Language and runtime**: TypeScript in `src/main`, `src/shared` and `src/adapters`. Plain JS in `src/renderer` (`harnesses.js`, `screens.js`). Electron main and preload.
- **Dependencies**: none new. Child processes use Node's `child_process.execFile` through the existing `nodeExec` (checks) and `HarnessSetup` (updates). HTTPS uses `officialinstall.ts`'s `HttpGet` (`makeGet`, `httpsGet`) with a new allow-list entry for version lookups.
- **Storage**: `SettingsStore` (`src/main/settings.ts`) gains `announcedVersions: Record<'claude'|'codex'|'copilot', string>`, holding version strings only. Results stay in memory.
- **Testing**: new `scripts/test-updatecheck.ts` (pure parsers, source detection, decision rules, announce rule, failure classes, start scheduling with fakes). It extends `scripts/test-harnesssetup.ts` (update argv per source, `codex update` fallback, the session gate). A simulator driver `scripts/shots-081-updates.js` covers the card, dialog, badge and toast. All of this runs with 0 AI credits and no network: `nodeExec` and `HttpGet` are injected.
- **Platforms**: Windows, macOS and Linux. Path logic is pure, with `path.win32` and `path.posix` and an injected environment, the same as `routeOwning` and `candidates`.
- **Performance**: the start check must not delay first paint (SC-007). It runs one app at a time, with a 30 s limit each and output capped at 64 KiB. Each start makes at most one tool run or one HTTPS GET per app.
- **Constraints**: no shell. Argv comes only from fixed tables. The window sends an app id and a route index, nothing more. No sudo or elevation. Output is masked (`redact()` plus the OAuth mask), and nothing is logged.

## Constitution Check

| Principle | How this plan complies |
|---|---|
| I Spec Kit | Spec, plan and tasks come before any `src/` change. Q1-Q5 are answered by the owner and recorded. |
| II Adapter boundary | Version, source and update knowledge for the CLIs lives in `src/shared/updatecheck.ts` (pure) and `src/main/updatecheck.ts`, beside the existing `harnesssetup` modules. The renderer sees only app ids, version strings, the source label and states. No vendor event names are involved. The bundled Copilot runtime stays pinned (FR-002). |
| III Safe by default | Nothing updates without the native confirmation (SC-003), including a waiting update, which is confirmed again when it runs. Argv arrays only, `shell: false`. Fixed hosts for the HTTPS lookups. No credentials: `.npmrc` is never read, and Copilot's authenticated `copilot version` is never used. Output is masked. The start check is the owner's decision (Q1 = C). It sends nothing of Durbar's (FR-017), it is listed in the README, and organization policy can turn it off. |
| IV No AI credits | Checks and updates call package managers and the vendors' release endpoints, never a model. Tests use fixtures. A real update is a separate, owner-approved task (T040). |
| V Calm UI | One status line and a chip with a word on each card. A quiet badge. One toast per new version only. The 1440x900 and 1280x800 screenshots are part of the tasks. |
| VI Platforms | Per-OS routes. Windows locked files are handled through the session gate and the failure classes. Real-machine checks are `[KNOWN GAP]` until T040, T041 and T042 record them. |
| VII Quality gates | Unit tests for every new rule, with mutations listed in the tasks. A simulator driver. typecheck, build and test. |
| VIII Honest limits | `codex update` is marked undocumented. Homebrew data is labelled *as Homebrew knows it*. winget fixtures wait for a recorded run. The `downloads.claude.ai` channel files are not a documented API (see D4). |

No violations, so Complexity Tracking is empty.

## Design

### D1 Modules (reuse first)

| Existing code | Reused for | Change |
|---|---|---|
| `src/adapters/detect.ts` `parseVersion`, `compareVersions`, `detectBinary`, `candidates`, `displayPath`, `nodeExec` | installed version, version compare, finding the tool, running checks | none. A pre-release-aware compare goes in `updatecheck.ts` on top of `compareVersions`. |
| `src/shared/harnesssetup.ts` `ROUTES`, `updatePlans`, `routeOwning`, `runRequest`, `lastLines`, `stripAnsi` | update argv per source, owning source, request validation, output | `routeOwning` learns Codex's `packages/standalone`, `~/.copilot/pkg`, Scoop (named, no route) and Linux `/usr/bin` / `/snap` (outside). It returns the cask name too (`claude-code` vs `claude-code@latest`). Copilot's brew update gains `--greedy`. The official route for update gains an *own updater* step (D3). |
| `src/main/harnesssetup.ts` `HarnessSetup.plans`, `prepare`, `start`, `cancel`, `trustedPath`, `busy` | the whole update run and its native confirmation | `prepare` accepts an own-updater plan (binary = the app itself, fixed args). On a Codex own-updater failure that is not *in use* or *managed*, `finish` reports `fallback: 'official'`. |
| `src/main/officialinstall.ts` `HttpGet`, `makeGet`, allow-list per hop, caps | the HTTPS version lookups (Codex and Copilot GitHub releases, Claude channel) | a `VERSION_SOURCES` allow-list (exact host and path prefix), `maxBytes` 64 KiB, 10 s. Redirects only within the list. |
| `src/main/ipc/harness.ts`, `src/preload/preload.ts` | channels | new `harness:updates` (get the kept results, optionally `'check'`), the event `harness:updatesChanged`, and the op `'update'` on `harness:run` gaining the session-gate answer (D5). `scripts/test-ipc-channels` lists them. |
| `src/renderer/harnesses.js` cards, plan dialog, progress modal | status line, chip, *Check for updates*, Update…, session dialog | extended in place. No new dialog component: it uses `modal()` and the existing plan dialog. |
| `src/renderer/screens.js` Settings entry | badge on *Settings > Agent apps* | a badge count from `harness:updates`. |
| renderer `toast()` (`app.js`) | the one toast per new version | none. |
| `SettingsStore` | `announcedVersions` | new getter and setter with validation (an allowed app id and a version that matches `parseVersion`, at most 64 characters). |
| `agentops.ts` `endSessionOp`, main's `agents` map | counting and ending a given app's sessions | a small `sessionsOf(adapterId)` helper in main. "End N sessions" calls the existing `endSessionOp` for each. |
| spec 076 policy reader (when built) | `allowInAppInstall`, the version range | read through one function `updatePolicy()`. Until 076 lands it returns "allowed, no range" (T030 wires it in). |

New files:
- `src/shared/updatecheck.ts` (pure): the source descriptor from a real path and the platform. Check argv per source. Parsers for `npm view --json`, `brew info --json=v2` and `brew outdated --json=v2`, the winget table, GitHub `releases/latest` JSON (tag prefix `rust-v` / `v`) and the Claude channel text. The decision (`up-to-date`, `update-available`, `could-not-check`, `outside`), the announce rule, the failure classifier and the policy filter.
- `src/main/updatecheck.ts`: `UpdateChecker`, with the start scheduling, the queue (one app at a time), the in-memory results, the Copilot CLI version read, and change events to the window.
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

- **Check**: npm `['view', pkg, 'version', '--json']`. brew `['info', '--cask', '--json=v2', cask]`, with env `HOMEBREW_NO_AUTO_UPDATE=1`, plus `['outdated', '--cask', '--json=v2', ...(greedy ? ['--greedy'] : []), cask]` for the decision. winget `['list', '--id', id, '-e', '--upgrade-available', '--source', 'winget', '--accept-source-agreements']`. official: an HTTPS GET from `VERSION_SOURCES`.
- **Update**: the existing `ROUTES[*].update`, plus the own updaters `['update']` for `claude`, `copilot` and `codex`, run as the found binary of that copy (its real path, `trustedPath`). Codex fallback: the existing official plan with `CODEX_NON_INTERACTIVE=1` added to that child's environment only. It gets its own native confirmation, because a script is downloaded.
- The *missing command* test for `codex update` is exit code 2 together with the clap "unrecognized subcommand" text, or no version change and usage text. The decision is captured in fixtures, not guessed at run time beyond those two shapes.

### D4 Claude Code native "latest"

`downloads.claude.ai/claude-code-releases/{stable|latest}` answers plain text, but it is not a documented API (research R7). The plan uses it, because it is the host Claude Code's own updater uses and the update route already allows it. The channel comes from the user's `autoUpdatesChannel` only if Durbar can know it without reading Claude's settings files. It cannot, so the card compares with `latest` and says *latest channel*. If the answer is not a version, the card shows *Could not check*. The npm dist-tag is used only for a Claude installed by npm. This is recorded as `[KNOWN GAP]`: the channel files may change without notice.

### D5 Session gate (Q2 = A)

`harness:run(kind, 'update', idx, gate?)`. Main counts `sessionsOf(adapter)`, where `claude` maps to the claude adapter, `codex` to the codex adapter, and `copilot` (the CLI) has none:
- `0`: today's flow.
- more than 0 and no `gate`: the call returns `{needsGate: n}`, and the window shows the three-choice dialog.
- `gate:'wait'`: main stores `waiting[kind] = {idx}`. New sessions of that adapter are refused with a reason (in `agents:create`, `agents:start` and resume). When the count reaches 0, main runs `prepare` and the native confirmation. Cancel drops the waiting update.
- `gate:'end'`: `endSessionOp` for each session, then `prepare` and the confirmation.

A waiting update lives in memory only. Quit drops it.

### D6 Start check (Q1 = C)

`UpdateChecker.scheduleStart()` is called from main after the window's first `did-finish-load` and after `adaptersInfo` resolves. A `setImmediate` chain then runs one app at a time. It is skipped when `SIMULATOR` is set (canned answers) or when `updatePolicy().allowInAppInstall === false`. Results go to memory, and `harness:updatesChanged` is sent. Errors set `could-not-check` with a short masked reason, and nothing else happens. A manual *Check for updates* while the start check runs joins it rather than doubling it.

### D7 Announce (Q5 = B)

When a result is `update-available` and its version differs from `announcedVersions[app]`, main sends `announce` with the change event, unless the window reports that Settings > Agent apps is visible. Main then saves the version. The renderer shows `toast()` once and the badge (`hs-badge`, with a word, not only a colour).

### D8 Failure classes (FR-014)

`classifyFailure({code, errorCode, text, platform, source})` returns one of `admin`, `in-use`, `managed`, `uac-cancelled`, `network` or `other`. Each class is tested against captured fixtures. Patterns are matched case-insensitively on the masked text, and the raw output is never kept. The advice strings live in the renderer table next to the existing ones.

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
src/main/officialinstall.ts        (VERSION_SOURCES allow-list)
src/main/settings.ts               (announcedVersions)
src/main/ipc/harness.ts            (harness:updates, gate arg)
src/main/main.ts                   (start scheduling, sessionsOf, refuse starts while waiting)
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

- README *Safety model* and *Agent apps*: the start check, what it contacts (the FR-017 table), how organization policy turns it off, and that `codex update` is undocumented.
- `docs/agent-notes.md`: an entry for each vendor's updater behaviour once it is verified on a real machine.
- `changelog.d/081-cli-updates.md`.
- Screenshots: Settings > Agent apps (cards with a status line), the session gate dialog and the badge, at 1440x900 and 1280x800. `npm run shots:docs -- --only <setup driver>` retakes the linked Agent apps pictures.

## Complexity Tracking

None.

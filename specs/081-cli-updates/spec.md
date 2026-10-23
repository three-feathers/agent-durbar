# Feature Specification: Agent-app updates: see the installed and latest version, and update from the right source

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Agent-app updates (owner request, issue #662): Settings > Agent apps shows "installed X, latest Y" per app, checked in the background at every Durbar start and on "Check for updates" (owner decision Q1 = C; organization policy can turn it off); a new version gets a badge and one toast; Update runs the updater of the source that installed the copy Durbar uses (no shell, argv, native confirmation, masked output); open sessions are warned about, ended or waited for; failures (admin rights, managed machines, locked files on Windows) say what to do
status: Draft (2026-10-23): spec, research, plan and tasks; Q1-Q5 answered by Vikram (B, A, C, A, B); nothing built
-->

**Feature Branch**: `081-cli-updates` (extends 051 harness setup, 060 platform parity and 012 detection; reads 076 managed config)

**Created**: 2026-10-23

**Status**: Draft. Spec, research, plan and tasks; Q1-Q5 answered by the owner (Clarifications); nothing is built. Every requirement is `[PLANNED]` unless tagged otherwise.

**Input**: Issue #662, owner request (Vikram, 2026-10-23, DM): "lets add support to check updates on cli and upgrade it". The CLIs are the agent apps Durbar drives: Codex CLI, Claude Code and the GitHub Copilot CLI. The trigger was a Codex 0.163.0 sandbox bug on macOS (Homebrew cask, `/opt/homebrew/bin/codex`): today the only way to get a fixed Codex is to leave Durbar and update it by hand, and Durbar does not even say that a newer version exists.

Research, with the evidence for each vendor and source: [research.md](research.md).

## Context: what exists today

Durbar already does most of the work an update needs. This spec reuses it and adds what is missing; it does not add a parallel installer.

- **Version detection** (spec 012 FR-035..FR-041, `read:` `src/adapters/detect.ts`). `detectBinary` finds `claude` and `codex` (configured path, `PATH`, the login shell's `PATH`, known install folders incl. Homebrew, `~/.local/bin`, `%APPDATA%\npm`, WinGet Links, OpenAI's `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`, version managers), runs `--version` with an argv array and no shell (`nodeExec`: 5 s, 64 KiB cap), and returns `ready`, `too-old` (below `CODEX_MIN_VERSION` = 0.163.0) or `unknown`, plus `where` (a display path, never the user name). `parseVersion` and `compareVersions` exist.
- **Copilot is different.** Copilot sessions run the **Copilot runtime bundled with `@github/copilot-sdk`** (pinned at 1.0.22 in `package.json`; `src/adapters/runtime.ts` `unpackedRuntimePath`). It changes only with a Durbar release (constitution II: pin the vendor runtime). The user's own **GitHub Copilot CLI** (`copilot`) is used only to sign in (spec 051 FR-006). `detectCopilot()` returns `ready` with no version and no I/O.
- **Install and update routes** (spec 051 FR-002..FR-004c, spec 060 FR-001, `read:` `src/shared/harnesssetup.ts`, `src/main/harnesssetup.ts`):
  - `ROUTES` holds, per app and OS, fixed argv for `install` and `update`: `npm install -g <pkg>@latest`, `brew upgrade --cask <cask>`, `winget upgrade --id <id> -e --source winget …`, and the vendor's official installer (downloaded from fixed hosts by `src/main/officialinstall.ts`, run as `bash <file>` / `powershell -File <file>`).
  - `routeOwning(realPath)` tells which route owns a binary from its real path (`node_modules` / npm `.cmd` → npm; `Cellar`, `Caskroom`, `/opt/homebrew/`, linuxbrew → brew; `WinGet/Packages|Links` → winget; `~/.local/bin|share`, `~/.claude/local`, `Programs/OpenAI/Codex` → official). `HarnessSetup.plans(kind, 'update')` puts that route first, so an update never leaves a second copy.
  - `HarnessSetup.prepare` → native main-side confirmation with the real path and the arguments (FR-004b) → `start`; one operation at a time (`busy`); refused as root for the official script; world-writable binaries refused (`trustedPath`); output shown as the last lines, ANSI stripped, passed through `redact()` and the OAuth mask; Homebrew owned by another account and system-wide npm get a note.
  - IPC: `harness:plans`, `harness:run` (index into main's table only, `runRequest`), `harness:cancel`.
- **Settings > Agent apps** (`read:` `src/renderer/harnesses.js`): one card per app with a state chip, "Version x.y.z.", "Found at …", and one next step. **Update… appears only when the app is below Durbar's minimum (`too-old`)**; a ready app has no update action and no "latest" information.
- **Managed configuration** (spec 076, draft): `agentApps.allowInAppInstall: false` hides Install and Update (FR-032, FR-175); `agentApps.versions.<app>.min/max` marks a version outside the range (FR-188, FR-189). Durbar's own app updater does not exist (FR-174: reserved).
- **What is missing:** no "latest version" lookup at all; no Update for an app that works but is old; no awareness of open sessions during an update; no `claude update`; no Copilot CLI version; no periodic check; failures show an exit code and the last lines, with no advice for the usual causes (admin rights, a locked file on Windows, a managed machine).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See whether an agent app is out of date (Priority: P1) MVP

I open **Settings > Agent apps**. Each card says which version I have and where it came from (*Installed 0.163.0 · Homebrew*). I choose **Check for updates**; a moment later the card says *Latest 0.170.0* and its chip says *Update available*. Durbar also checks by itself in the background at every start, so the card usually has the answer before I open it.

**Why this priority**: the owner could not tell that a fixed Codex existed. Knowing is the first step, and it is safe (read-only).

**Independent Test**: on the simulator (canned versions, no network) a card shows installed, source and, after *Check for updates*, latest and the chip; a unit test feeds each source's real output shape to the parser.

**Acceptance Scenarios**:

1. **Given** Codex 0.163.0 installed by the Homebrew cask, **When** I choose *Check for updates*, **Then** the card shows *Installed 0.163.0 · Homebrew* and *Latest 0.170.0* (the version Homebrew offers), the chip *Update available*, and the time of the check.
2. **Given** Claude Code installed by the native installer and already newest, **When** I check, **Then** the card says *Up to date (2.1.309)*.
3. **Given** Durbar starts, **Then** the office appears as fast as without this feature, and only after it is shown does the background check run, once per installed app; Settings > Agent apps shows *Checking…* on a card whose check is still running.
4. **Given** the start check ran, **When** I open Settings > Agent apps (once or many times), **Then** the cards show its result and time and no further check runs; *Check for updates* asks anew.
5. **Given** the source cannot be reached (offline, proxy, timeout), **Then** the card says *Could not check: <short reason>* and keeps the installed version; nothing else fails.
6. **Given** the copy Durbar uses was installed by something Durbar does not manage (for example a Linux distribution package under `/usr/bin`), **Then** the card says *Installed 2.1.300 · installed outside Durbar's routes* and offers no Update; it names where to update it if the path says (see FR-012).

---

### User Story 2 - Update with one click, from the source that installed it (Priority: P1) MVP

On a card that says *Update available* I choose **Update…**. Durbar shows what it will run (*brew upgrade --cask codex*), from where, and that it runs as me. After I confirm, the card shows the update's output (masked) and then the new version.

**Why this priority**: this is the owner's request; the route table and the runner already exist (spec 051), so the step is small.

**Independent Test**: unit tests for route choice per source and OS (fixed argv, no shell) and for the version re-read; a simulator driver for the dialog, progress and the new version.

**Acceptance Scenarios**:

1. **Given** Codex from the Homebrew cask, **When** I choose *Update…*, **Then** the dialog names Homebrew, the command `brew upgrade --cask codex`, the real path of `brew`, and *Update*; Cancel is the default; nothing runs until I confirm in the native confirmation (spec 051 FR-004b).
2. **Given** I confirm, **Then** the output appears as the last lines, ANSI removed and masked (`redact()` and the OAuth mask), and on success detection runs again and the card shows the new version.
3. **Given** Claude Code from the native installer, **Then** the update runs Claude Code's own updater (`claude update`) instead of downloading the installer again; the GitHub Copilot CLI from its install script runs `copilot update`; Codex from its installer runs `codex update` (undocumented), and the official installer only if that fails or is missing (Clarifications, Q3).
4. **Given** the update ends but detection still finds the old version (another copy earlier on `PATH`), **Then** the card says *Updated, but Durbar still finds 0.163.0 at /usr/local/bin/codex* and names both paths.
5. **Given** no update was ever asked for, **Then** Durbar never updates an app by itself (no automatic updates, not even after the start check finds one).

---

### User Story 3 - Open sessions are not broken by an update (Priority: P1) MVP

I have three Codex sessions open when I choose *Update…*. Durbar tells me so before anything runs and lets me choose: **Update when they end**, **End 3 sessions and update**, or Cancel.

**Why this priority**: a Codex or Claude Code session is a long-running child process (`codex app-server`, `claude -p --input-format stream-json`). On Windows a running `.exe` cannot be replaced, so the update fails; on macOS and Linux the running sessions keep the old program while new ones get the new one, which can mix two protocol versions.

**Independent Test**: unit test of the session count per app and of the queued update; simulator driver with open simulated sessions.

**Acceptance Scenarios**:

1. **Given** 3 open Codex sessions, **When** I choose *Update…*, **Then** the dialog says *3 Codex sessions are open* and offers *Update when they end* (default; Clarifications, Q2), *End 3 sessions and update*, and Cancel.
2. **Given** I choose *Update when they end*, **Then** the card shows *Update waiting for 3 sessions* with a Cancel link; when the last Codex session ends, the native confirmation appears again and the update runs only after it; new Codex sessions cannot start while the update is waiting to run or running (the start says why).
3. **Given** I choose *End 3 sessions and update*, **Then** the sessions end the way *End session* ends them (a turn in progress is interrupted first; each session stays resumable), then the update runs.
4. **Given** Copilot sessions are open, **When** I update the GitHub Copilot CLI, **Then** no warning appears: Copilot sessions run Durbar's bundled runtime, not the CLI.

---

### User Story 4 - Failures say what to do (Priority: P2)

When an update fails because it needs administrator rights, the machine is managed, the file is in use (Windows) or the source refuses, the card says which, in plain words, and offers the command to copy and run myself or the vendor's page.

**Why this priority**: failures are common (system-wide npm, a Homebrew installed by another account, winget on a locked-down machine); a bare exit code is not useful.

**Independent Test**: unit test that classifies captured outputs of each failure kind; no real failure has to be produced.

**Acceptance Scenarios**:

1. **Given** npm's global folder belongs to root, **When** the update fails with `EACCES`, **Then** the card says *Needs administrator rights: Durbar never runs sudo. Run this yourself:* with the command to copy, and the vendor's page.
2. **Given** Windows and a running `codex.exe` outside Durbar, **When** the update fails with a locked file (`EBUSY`, `EPERM`, "being used by another process"), **Then** the card says *Codex is still running somewhere (a terminal or an editor). Close it and try again.*
3. **Given** the organization's policy (spec 076) disables in-app updates, **Then** the card shows the versions but no Update, and says *Updates are managed by your organization*.
4. **Given** the update needs a UAC prompt (winget, machine-wide package), **Then** the prompt is Windows' own; Durbar waits and reports the result; a refused prompt is reported as *Cancelled at the administrator prompt*.

---

### User Story 5 - A new version is announced once (Priority: P3)

When the start check finds a new version, the Settings entry and the card get a quiet *Update available* badge, and one toast tells me (*Codex 0.170.0 is available*). The next start does not toast the same version again. Nothing is installed.

**Why this priority**: convenience; the card already shows the result.

**Independent Test**: unit test of the announce rule (one toast per app and version, across restarts; none for a failed check) and that it never starts an update; simulator driver for the badge and the toast.

**Acceptance Scenarios**:

1. **Given** Durbar starts and Codex 0.170.0 is newer than my 0.163.0, **Then** the badge appears and one toast is shown.
2. **Given** the next start finds the same 0.170.0, **Then** the badge is shown again but no toast; a later 0.171.0 gets its own toast.
3. **Given** a check finds an update, **Then** the badge appears and one toast says *Codex 0.170.0 is available* (once per new version per app, never again for the same version); no update runs (Clarifications, Q5).

---

### Edge Cases

- **Two copies on the machine** (npm and Homebrew): Durbar checks and updates the copy detection uses (the one it runs), and names it; it says so when another copy exists in a known folder (FR-011).
- **Pre-release installed** (`2.2.0-beta.1`): "latest" is the stable channel; a pre-release newer than the stable one is *Up to date (pre-release)*, never "downgrade available".
- **Version text Durbar cannot parse** from the source: *Could not check: unexpected answer*; the raw text is not shown (it is untrusted and may be long).
- **The source answers with something hostile** (huge output, control characters, a version with markup): output is capped, ANSI and control characters stripped, the version must match `x.y.z[-pre]` and at most 64 characters, and everything shown is escaped.
- **Homebrew cask that updates itself** (`auto_updates true`, `copilot-cli`): `brew outdated` and `brew upgrade` skip it unless `--greedy`; Durbar adds `--greedy` for that cask only (research R2).
- **The app updated itself meanwhile** (Claude Code native and the Copilot CLI have background updaters): detection reads the version again before the dialog; an app already at the latest gets no Update.
- **Claude Code on Homebrew's stable cask** is a week behind npm's `latest`: Durbar compares with the cask, so it says *Up to date* (with the cask's channel named), not *Update available* (research R2).
- **Copilot CLI's `copilot version` checks for updates online**: never used as a version probe (FR-002).
- **Homebrew's local data is old**: what Homebrew offers depends on its last refresh; the card says *as Homebrew knows it*; Durbar never runs `brew update` (Clarifications, Q4).
- **npm with a private registry or proxy** (corporate): Durbar runs the user's own npm, so its `.npmrc` registry and proxy apply; Durbar never reads `.npmrc` (it may hold a token).
- **Version managers** (nvm, fnm, Volta): the npm that owns the copy is the one in the same Node.js folder as the binary, not the first `npm` on `PATH`; Durbar uses that one (FR-006).
- **An update that downgrades** (the source offers a lower version than installed, e.g. a yanked release): no Update offered; *Installed is newer than the source's latest*.
- **The update leaves the app below Durbar's minimum or outside the organization's range**: the card says so, as detection already does (`too-old`, spec 076 FR-188).
- **Durbar quits while an update runs**: the child is ended as spec 051 ends a setup step; the card re-detects on the next start.
- **A queued update and the app quits**: the queue is dropped (not persisted); nothing runs at the next start.
- **Simulator**: never contacts a source and never runs a package manager; canned answers per app (FR-020).
- **Managed machine with no network to the source** (air-gapped, spec 076 FR-162): the check fails quietly with *Could not check*; the start check can be turned off by policy (FR-003); offline start checks are silent apart from the card.

## Requirements *(mandatory)*

### Install source and installed version (US1)

- **FR-001** `[PLANNED]` Each Settings > Agent apps card for Claude Code and Codex shows the installed version (from detection, spec 012) and the **install source** of the copy Durbar uses: *Homebrew*, *npm*, *winget*, *the official installer* or *installed outside Durbar's routes*. The source comes from the existing `routeOwning(realPath)` on the binary's real path (symlinks resolved), extended per research R5 (Scoop, the Claude native `versions` folder, Codex's standalone folder, `%APPDATA%\npm` shims). No new path-reading code beside it.
- **FR-002** `[PLANNED]` The Copilot card shows two lines: *Copilot runtime 1.0.x, bundled with Durbar (updates with Durbar)*, read from the bundled SDK's package version at no I/O cost beyond reading its `package.json` once, with no Update; and, when the user's GitHub Copilot CLI is found, *GitHub Copilot CLI x.y.z · <source> (used to sign in)* with the same check and Update as the other apps. Copilot detection itself stays free of process launches (spec 051 FR-007): the CLI's version is read by the background update check (FR-003), not by detection, with `copilot --version` if a recorded run shows it prints the version without a network call, else from the version folder or package file of the copy (research R3: `copilot version` checks online, so it is never used).

### Checking for the latest version (US1, US5)

- **FR-003** `[PLANNED]` **When Durbar contacts a source** (owner decision Q1 = B). Only in three cases:
  - the user chooses *Check for updates* (all apps) or a card's own *Check*;
  - **at every Durbar start** (owner decision Q1 = C, changed from B on 2026-10-23): one check per installed app, in the background, started only after the office is shown and the existing startup detection has finished, one app at a time (at most one package-manager process at once), each with its own 30 s limit. It never blocks or delays the office, a session start or Settings; its result is kept in memory for the app run (opening Settings shows it with its time and runs nothing). The section's note says so (*Durbar checks for updates each time it starts*).
  Starting a session or opening any screen never contacts a source for this feature. The simulator never does (FR-020).
  **Failures are silent** apart from the card's status (*Could not check: …*): no toast, no dialog, no log line with output.
  **Policy** (spec 076): when `agentApps.allowInAppInstall` is `false` (FR-032, FR-175) the start check does not run (the cards say *Updates are managed by your organization*); *Check for updates* stays available as a read-only check. Air-gapped machines (076 FR-162) set the same key.
  **No periodic re-check while Durbar stays open.** The owner chose start-time checking; a timer would add contacts nobody asked for. A long-running app shows the check's time on the card, and *Check for updates* refreshes it. (The draft's daily switch is dropped: with a check at every start it only mattered for an app left open for days, which the button covers.)
- **FR-004** `[PLANNED]` **The latest version comes from the install source of the copy Durbar uses**, by running that source's own tool where one exists, with fixed argv, no shell, the existing `nodeExec` limits (no window, capped output) and a 30 s time limit per app:
  - **npm**: `npm view <package> version --json` with the npm that owns the copy (FR-006); `<package>` from the route table (`@openai/codex`, `@anthropic-ai/claude-code`, `@github/copilot`).
  - **Homebrew**: `brew info --cask --json=v2 <cask>` (`version`) and `brew outdated --cask --json=v2 <cask>`, with `--greedy` only for a cask marked `auto_updates` (`copilot-cli`, research R2); the cask is the one in the real path (`claude-code` follows Anthropic's stable channel, `claude-code@latest` the latest one). Homebrew's data is used as it is: Durbar never runs `brew update` (owner decision Q4 = A), runs the check with `HOMEBREW_NO_AUTO_UPDATE=1` so Homebrew does not refresh on its own either, and labels the answer *as Homebrew knows it*. (`brew upgrade`, when the user updates, refreshes as Homebrew normally does.)
  - **winget**: `winget list --id <id> -e --upgrade-available --source winget --accept-source-agreements` (or `winget show`, research R4); the `Available` column.
  - **Official installer**: never the app's own `version`/`update` command as a probe (`copilot version` itself checks for updates with the user's GitHub sign-in, research R3). Codex and the Copilot CLI: the GitHub releases API without credentials (`api.github.com/repos/openai/codex/releases/latest`, tag `rust-vX.Y.Z`; `…/github/copilot-cli/releases/latest`, tag `vX.Y.Z`), the source each vendor's own update check uses (research R3, R7). Claude Code native: the release channel the user's Claude Code follows, from `downloads.claude.ai` (the host its own updater uses; the `latest` channel file, plan D4; it is not a documented API, so a non-version answer gives *Could not check*); Claude Code installed by npm uses npm. A source with no way to ask gives *Latest: cannot be checked for this install*, never a guess.
- **FR-005** `[PLANNED]` The answer is parsed as untrusted input: output capped at 64 KiB, ANSI and control characters removed, JSON parsed with a size cap where the tool prints JSON, the version accepted only if it matches `parseVersion` and is at most 64 characters. "Latest" is the newest **stable** version; pre-releases count only when the installed one is a pre-release of the same line. Compared with `compareVersions`.
- **FR-006** `[PLANNED]` **The right tool for the copy:** npm is the `npm` (or `npm.cmd`) in the same Node.js `bin` folder as the binary's real path (version managers keep one per Node.js version), else the first found npm only when its global prefix contains the binary; Homebrew is the `brew` of the prefix the binary lives under (`/opt/homebrew`, `/usr/local`, `/home/linuxbrew/.linuxbrew`). When no matching tool is found, the card says *Cannot check: <tool> for this copy was not found*.
- **FR-007** `[PLANNED]` The card shows *Latest x.y.z* with the source's name (*as Homebrew knows it* for Homebrew), the time of the check, and a chip: *Up to date*, *Update available*, *Could not check* or *Not checked*. The state is not shown by colour alone (constitution V). The result lives in memory for the app run; only the last announced version per app is saved (FR-016).

### Updating (US2, US3)

- **FR-008** `[PLANNED]` **Update…** appears on a card when the latest version is newer than the installed one (as well as for `too-old`, as today), unless the organization disables it (spec 076 FR-032) or the version range forbids the latest (FR-188: latest above `max` gives *Version x.y.z is not allowed by your organization*). It reuses spec 051's flow: the plan dialog lists the routes with the **owning route first and preselected** (existing `HarnessSetup.plans(kind, 'update')`), then `prepare` → native confirmation with the real path and the full argv → `start`. Only the owning route is offered for an update when it is known; other routes would install a second copy, so they are hidden behind *Show other ways* with that warning.
- **FR-009** `[PLANNED]` **The updater per source** (fixed argv, no shell; table in research R6):
  - npm: `npm install -g <package>@latest`, with the owning npm (FR-006);
  - Homebrew: `brew upgrade --cask <cask>` (with `--greedy` only if the cask updates itself and the check said so);
  - winget: `winget upgrade --id <id> -e --source winget` plus the agreement flags the dialog already shows;
  - official installer (owner decision Q3 = C): the app's own updater: `claude update` (Claude Code native, documented), `copilot update` (Copilot CLI, documented), and `codex update` (Codex, **undocumented**: it exists in Codex's source, `codex-rs/cli/src/main.rs`, not in OpenAI's docs; the dialog and the docs say so). When `codex update` is missing (the CLI answers with an unknown-command error or usage text), or fails (non-zero exit that is not a FR-014 *File in use* or *Managed*), Durbar offers the official installer as spec 060 FR-001 runs it, with `CODEX_NON_INTERACTIVE=1` set in its environment (OpenAI's own update hint, research R3), after its own native confirmation (it downloads a script). `claude update` reporting "up to date" while a newer version exists means updates are blocked (`DISABLE_UPDATES` or a managed setting): FR-014 *Managed*.
  - Never `sudo`, `runas` or an elevation of Durbar's own; winget may raise Windows' own UAC prompt for a machine-wide package.
- **FR-010** `[PLANNED]` Output: the existing masked last-lines view (strip ANSI, `redact()`, OAuth mask, 200 characters per line); the full output is never logged, saved or sent. Durbar's existing time limit and Cancel for a setup step apply.
- **FR-011** `[PLANNED]` After the update, detection runs again (spec 051 FR-004). If the version did not change, or another copy is found first, the card names the copy that was updated and the one Durbar finds. Durbar does not remove or reorder copies.
- **FR-012** `[PLANNED]` A copy installed outside Durbar's routes (unknown source, distribution packages, a hand-copied binary) gets no Update. When the real path says where it came from (`/usr/bin` with a Linux distribution, `/snap/`), the card names that tool (*Update it with your system's package manager*), and offers the vendor's page.
- **FR-013** `[PLANNED]` **Open sessions** (US3). Before the plan dialog, main counts the open sessions whose adapter runs this app (Claude Code: `claude` adapter; Codex: `codex` adapter; the GitHub Copilot CLI: none, FR-002). With any open:
  - the dialog says how many and offers *Update when they end* (default), *End N sessions and update*, and Cancel (owner decision Q2 = A);
  - *Update when they end*: a waiting update per app, shown on the card with Cancel; no new session of that app starts while it waits or runs (the start says why and offers to cancel the waiting update); when the count reaches 0 the native confirmation appears again (consent is given at the moment of running, as spec 051 FR-004b requires); not saved across restarts;
  - *End N sessions and update*: each session ends as *End session* ends it (interrupt a turn in progress, keep it resumable), then the update starts;
  - on macOS and Linux a session that is still running when an update starts keeps the old program until it ends (the file is replaced, not the running image); Durbar does not offer "update now anyway" while sessions are open (Q2 = A).
- **FR-014** `[PLANNED]` **Failure advice** (US4). A failed check or update is classified from the exit code, the error code and the masked output, by a pure function with captured fixtures per source and OS:
  - *Needs administrator rights* (`EACCES`, `EPERM` on a folder Durbar does not own, Homebrew owned by another account): the command to copy, never an offer to elevate;
  - *File in use* (Windows `EBUSY`, `EPERM` on the binary, "being used by another process", winget's in-use result): name the app, ask to close it (inside Durbar, FR-013 already prevents this);
  - *Managed by your organization* (spec 076 policy, a winget/Group Policy refusal, Claude Code managed settings that turn its updater off where `claude update` says so): no retry offered;
  - *Cancelled at the administrator prompt* (UAC refused);
  - *Network or source problem* (timeout, DNS, proxy, 4xx/5xx);
  - otherwise *Update failed (exit N)* with the last lines and the vendor's page.

### Announcing a new version (US5)

- **FR-015** `[PLANNED]` Withdrawn before building (the daily switch; replaced by the start check, Q1 = C). The number is kept so later references stay stable.
- **FR-016** `[PLANNED]` A check (at start or on *Check for updates*) that finds an update marks the card and the Settings entry with a quiet *Update available* badge, and shows **one toast per new version** (owner decision Q5 = B): *<App> <version> is available. Open Settings > Agent apps to update.* The last announced version per app is saved (the version string only), so a version is announced once, also across restarts; when the user is looking at the card (*Check for updates*, or Settings open), the card is the announcement and no toast is shown, but the version still counts as announced. A failed check marks only the card; no toast. No system notification. Simulator: canned answers, and a saved announced version that a driver can reset.

### Privacy, safety and platforms (all stories)

- **FR-017** `[PLANNED]` **What each start contacts** (Q1 = C; the README's *Safety model* / privacy text and the Settings note list this table). Per installed app, only the source of the copy Durbar uses, by that source's own tool or the vendor host already allowed for its installer; at most one request (or one tool run) per app per start:

  | Install source of the copy | Contacted at each start | By |
  |---|---|---|
  | npm (any app) | the registry in the user's npm configuration (default `registry.npmjs.org`) | the user's `npm view` |
  | Homebrew (any app) | nothing expected: the check runs with `HOMEBREW_NO_AUTO_UPDATE=1`, so Homebrew answers from its local data (Q4 = A; *unconfirmed* that no Homebrew command contacts `formulae.brew.sh` then, to verify on a real Mac) | the user's `brew` |
  | winget (Claude Code, Copilot CLI) | the winget source (Microsoft's CDN; host not documented in the pages read) | the user's `winget` |
  | Codex, official installer | `api.github.com` (`/repos/openai/codex/releases/latest`), no credentials | Durbar main, https GET with the existing fixed-host fetch rules of `officialinstall.ts` (allow-list, no redirects off-list, size and time caps) |
  | Copilot CLI, install script | `api.github.com` (`/repos/github/copilot-cli/releases/latest`), no credentials | the same |
  | Claude Code, native installer | `downloads.claude.ai` (the release channel its own updater uses) | the same |
  | outside Durbar's routes | nothing | |

  Durbar adds no identifier, no installed version and no Durbar version to these requests (a plain `User-Agent` naming no user), keeps no log of the checks, and saves nothing but the announced versions (FR-016). The bundled Copilot runtime is never checked (it updates with Durbar).
- **FR-018** `[PLANNED]` Every command runs as an argv array with `shell: false`, through the existing runner (`HarnessSetup` for updates, `nodeExec` for checks); arguments come only from main's fixed table plus a package name from that table; nothing from the window except the app id and a route index (existing `runRequest`). Windows `.cmd` shims (npm) run the way spec 051 already runs them (verbatim arguments through `cmd.exe` with the fixed, checked argv).
- **FR-019** `[PLANNED]` **Platforms** (constitution VI): macOS (Homebrew cask, npm, official installer), Linux (official installer, npm, Linuxbrew), Windows (winget, npm, official PowerShell installer; Scoop is detected and named but not run, [KNOWN GAP] until a route exists). Path checks use `path.win32`/`path.posix` in pure functions with an injected environment, case-insensitive on Windows and macOS. Not verified on a real Mac or Windows machine until a task records it (`[KNOWN GAP]` per platform).
- **FR-020** `[PLANNED]` **Simulator** (constitution IV): canned installed and latest versions per app and source (one up to date, one with an update, one that cannot be checked), a canned update run, simulated sessions for US3; no network, no package manager.
- **FR-021** `[PLANNED]` **No real update in tests.** `npm test` uses fixtures of each tool's output (captured from documentation or a recorded run, with the source named); a real update on a real machine is a separate, owner-approved task (it changes the user's installed app).

### Out of scope

- Updating Durbar itself (spec 076 FR-174 reserves its updater; no updater exists).
- Updating the bundled Copilot runtime outside a Durbar release.
- Installing a specific older version (rollback, pinning). Npm and winget can; Homebrew casks cannot. A later spec, if asked.
- Turning on or off an app's own auto-updater (Claude Code's `autoUpdates`, `DISABLE_AUTOUPDATER`).
- A list of known-bad versions (for example the Codex 0.163.0 sandbox bug); a later spec if the owner wants it.

### Key Entities

- **Install source**: `npm` | `brew` | `winget` | `official` | `outside` (+ the tool's real path for `npm`/`brew`), derived from the binary's real path.
- **Version check result**: app, source, installed, latest (or none), state (`up-to-date`, `update-available`, `could-not-check`, `not-checked`), reason (short, masked), checked-at (monotonic and wall).
- **Waiting update**: app, route index, session count; memory only.
- **Announced versions**: per app, the last version shown in a toast (a version string; nothing else saved).

## Success Criteria *(mandatory)*

- **SC-001** With Codex from the Homebrew cask and an update published, the owner sees *Update available* within 30 s of choosing *Check for updates*, and has the new version after one *Update…* and one confirmation, without a terminal.
- **SC-002** Each Durbar start makes exactly one check per installed app, after the office is shown, and none when the policy turns updates off; opening Settings or starting a session makes none (a test counts runner calls).
- **SC-007** The time to show the office with 15 simulated agents is not longer with the start check on than with it off (simulator driver; the check is held back until after first paint).
- **SC-003** No update ever starts without the native confirmation (unit test: no path reaches `start` without it, also for a waiting update).
- **SC-004** An update with open sessions of that app never runs while they are open (unit test with a fake session list).
- **SC-005** Each failure kind in FR-014 shows its own message for its captured fixture on every OS that produces it.
- **SC-006** All text meets constitution V (10.5px, state not by colour alone) at 1440x900 and 1280x800 in the simulator.

## Assumptions

- Each source's tool prints the version in the shapes recorded in research.md; a vendor change shows up as *Could not check*, never as a wrong version.
- The user's own package-manager configuration (registry, proxy, Homebrew settings) is respected by running the user's tools rather than fetching URLs directly, except for the official route, which already fetches from fixed hosts.
- Detection's binary is the one sessions run (spec 012); updating it is what affects sessions.

## Known limits

- `[KNOWN GAP]` Not run on a real machine yet for any source; the parsers rely on documented output (`read:` in research.md) until a recorded run.
- `[KNOWN GAP]` Homebrew's "latest" is as fresh as its local data (Q4 = A: no `brew update`).
- `[KNOWN GAP]` `codex update` is undocumented (Q3 = C); a Codex release may remove or change it, which the fallback to the official installer covers.
- `[KNOWN GAP]` Scoop and Chocolatey copies, Linux apt/dnf/apk Claude Code packages and bun/pnpm global installs are named but not updated by Durbar (they need `sudo` or a route Durbar does not have).
- `[KNOWN GAP]` Codex has no winget route in Durbar although `OpenAI.Codex` exists in winget (research R1); a Codex installed that way is named, not updated, until a route is added.
- `[KNOWN GAP]` winget's text output (language-dependent column names) is parsed from recorded fixtures only once a Windows run records them (research R4).
- `[KNOWN GAP]` Windows ACLs are not read for the trust check (as in spec 051).

## Questions asked *(answered by the owner, 2026-10-23; see Clarifications)*

- **Q1** (answered: **C**, changed from B) **When may Durbar contact the package sources?**
  - A: only when I choose *Check for updates*, plus the daily switch (off by default). *Recommended*: no surprise network use (constitution III, no telemetry), matches the request.
  - B: also once per app run when Settings > Agent apps opens.
  - C: once at each Durbar start.
- **Q2** (answered: **A**) **What does Update do while sessions of that app are open?**
  - A: offer *Update when they end* (default) or *End N sessions and update*, and Cancel. *Recommended*: never breaks a session; works on Windows, where a running program cannot be replaced.
  - B: refuse until I end them myself.
  - C: also offer *Update now anyway* on macOS and Linux (open sessions keep the old program until they end; resumed ones get the new one).
- **Q3** (answered: **C**) **For an app installed by its vendor's own installer, what runs?**
  - A: the app's own documented updater (`claude update`, `copilot update`); Codex (no documented updater) gets its installer again with `CODEX_NON_INTERACTIVE=1`. *Recommended*: the vendor's supported path, nothing downloaded by Durbar for Claude and Copilot.
  - B: always the vendor's installer script again (spec 060 FR-001 as built).
  - C: as A, and also `codex update` for Codex (exists in Codex's source, not in its docs).
- **Q4** (answered: **A**) **May a Homebrew check refresh Homebrew's data?**
  - A: check with Homebrew's normal behaviour (its own automatic refresh of the API data, research R2) and label the answer *as Homebrew knows it*. *Recommended*: no extra side effects, honest label; `brew upgrade` refreshes anyway when it runs.
  - B: run `brew update` first on an explicit check (fresher, slower, changes Homebrew's state).
  - C: ask the vendor's public channel (npm or GitHub releases) instead of Homebrew (fresher, but the cask may lag behind, so "Update available" could be wrong).
- **Q5** (answered: **B**) **When a check finds an update, how loud?** (asked about the daily check; applies to the start check)
  - A: a quiet badge on the card and on the Settings entry only. *Recommended*: calm UI (constitution V).
  - B: also one toast per new version.
  - C: also a system notification.

## Clarifications

### Session 2026-10-23: owner decisions (Vikram, DM to his agent, 21:44-21:47 UTC, Q1 corrected at 21:48 UTC; also posted in the team chat and on #662 / #663)

- Q1 (when are sources contacted?) → **C** (Vikram first answered B at 21:44 and changed it to C at 21:48 UTC): at **every Durbar start**, in the background, plus the explicit *Check for updates*. Consequences recorded: the check runs after first paint without delaying the office; results are kept so the badge and toast do not repeat; network failures are silent apart from the card; spec 076 policy turns it off (FR-032, FR-175); the daily switch is dropped (FR-015 withdrawn; a re-check timer would add contacts nobody asked for, and the button covers an app left open for days); the endpoints contacted at each start are listed in FR-017 for the README and privacy text. Recorded in FR-003, FR-015, FR-017, US1, US5, SC-002, SC-007.
- Q2 (open sessions on Update) → **A**: *Update when they end* (default) / *End N sessions and update* / Cancel. Recorded in FR-013, US3.
- Q3 (vendor-installer copies) → **C**: the documented updaters `claude update` and `copilot update`, plus Codex's undocumented `codex update`, marked undocumented, with a fallback to the official installer (`CODEX_NON_INTERACTIVE=1`) when it fails or is missing. Recorded in FR-009, US2, Known limits.
- Q4 (Homebrew refresh) → **A**: no `brew update`; Homebrew's current data, labelled *as Homebrew knows it*. Recorded in FR-004, Edge Cases.
- Q5 (how loud is a found update) → **B**: a quiet badge on the card and the Settings entry, plus one toast per new version. Recorded in FR-016, US5.

## Changes

(none yet)

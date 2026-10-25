# Feature Specification: Agent-app updates: see the installed and latest version, and update from the right source

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Agent-app updates (owner request, issue #662): Settings > Agent apps shows "installed X, latest Y" per app, checked in the background at every Durbar start and on "Check for updates" (owner decision Q1 = C; organization policy can turn it off); a new version gets a badge and one toast; Update runs the updater of the source that installed the copy Durbar uses (no shell, argv, native confirmation, masked output); open sessions are warned about, ended or waited for; failures (admin rights, managed machines, locked files on Windows) say what to do
status: Draft (2026-10-25): spec, research, plan and tasks; Q1-Q7 answered by Vikram (C, A, C limited to the official Codex CLI, A, B, A, C); Paco's 15 review items folded in; nothing built
-->

**Feature Branch**: `081-cli-updates` (extends 051 harness setup, 060 platform parity and 012 detection; reads 076 managed config)

**Created**: 2026-10-23

**Status**: Draft. Spec, research, plan and tasks. Q1-Q7 are answered by the owner (Clarifications; Q3 asked again and answered, and Q6 and Q7 answered, on 2026-10-25). Nothing is built. Every requirement is `[PLANNED]` unless tagged otherwise.

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
3. **Given** Claude Code from the native installer, **Then** the update runs Claude Code's own updater (`claude update`) instead of downloading the installer again; the GitHub Copilot CLI from its install script runs `copilot update`; Codex from its installer gets the official installer again, through spec 060's allow-listed download, with `CODEX_NON_INTERACTIVE=1` (FR-009; Q3 asked again).
4. **Given** the update ends but detection still finds the old version (another copy earlier on `PATH`), **Then** the card says *Updated, but Durbar still finds 0.163.0 at /usr/local/bin/codex* and names both paths.
5. **Given** no update was ever asked for, **Then** Durbar never updates an app by itself (no automatic updates, not even after the start check finds one).

---

### User Story 3 - Open sessions are not broken by an update (Priority: P1) MVP

I have three Codex sessions open when I choose *Update…*. Durbar tells me so before anything runs and lets me choose: **Update when they end**, **End 3 sessions and update**, or Cancel.

**Why this priority**: a Codex or Claude Code session is a long-running child process (`codex app-server`, `claude -p --input-format stream-json`). On Windows a running `.exe` cannot be replaced, so the update fails; on macOS and Linux the running sessions keep the old program while new ones get the new one, which can mix two protocol versions.

**Independent Test**: unit test of the session count per app and of the queued update; simulator driver with open simulated sessions.

**Acceptance Scenarios**:

1. **Given** 3 open Codex sessions, **When** I choose *Update…*, **Then** the dialog says *3 Codex sessions are open* and offers *Update when they end* (default; Clarifications, Q2), *End 3 sessions and update*, and Cancel.
2. **Given** I choose *Update when they end*, **Then** the card shows *Update waiting for 3 sessions* with a Cancel link; when the last Codex session ends, the native confirmation appears again and the update runs only after it; from the moment I chose *Update…* until the update ends, new or resumed Codex sessions cannot start and scheduled prompts for them are held (the start says why; FR-013).
3. **Given** I choose *End 3 sessions and update*, **Then** the dialog uses the *End all sessions?* wording, naming the sessions still working, the pending permission requests and the held prompts. Each turn in progress is interrupted first, then the sessions end and stay resumable, then the native confirmation and the update follow.
4. **Given** a scheduled prompt or a resume arrives while the native confirmation is open, **Then** it is held, and after the confirmation Durbar counts again; if a session is open, the update does not start and the dialog comes back.
5. **Given** Copilot sessions are open, **When** I update the GitHub Copilot CLI, **Then** no warning appears: Copilot sessions run Durbar's bundled runtime, not the CLI.

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
- **Starting `copilot` can update it** (`copilot version` checks online, and the auto-updater may run at any start): Durbar never runs `copilot` to read its version, and reads it from the copy's files (FR-002).
- **Hostile or huge answers** (64 KiB of digits, a version inside an error line): strict parse of the structured field only (FR-005).
- **The source moves on between the check and the update**: checked again before the confirmation; pinned where the route can pin (FR-023).
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
- **FR-002** `[PLANNED]` The Copilot card shows two lines.
  - *Copilot runtime 1.0.x, bundled with Durbar (updates with Durbar)*: read from the bundled SDK's `package.json` once, with no Update.
  - When the user's GitHub Copilot CLI is found: *GitHub Copilot CLI x.y.z · <source> (used to sign in)*, with the same check and Update as the other apps.

  **Durbar never runs `copilot` to read its version.** `copilot version` checks for updates online with the user's GitHub sign-in, and starting `copilot` (also `--version`) may start its auto-updater, which writes `~/.copilot/pkg` and contacts GitHub (research R3; review on #663). The version comes from the copy's own files:
  - npm: `<prefix>/node_modules/@github/copilot/package.json` `version`, read with a 64 KiB cap, own property only;
  - Homebrew: the `Caskroom/copilot-cli/<version>/` folder name;
  - winget: the version in the package folder name;
  - script install: the version folder under `~/.copilot/pkg/` that the real path points into.

  Each value passes FR-005's strict parse. Copilot detection itself stays free of process launches (spec 051 FR-007).

### Checking for the latest version (US1, US5)

- **FR-003** `[PLANNED]` **When Durbar contacts a source** (owner decision Q1 = C, changed from B on 2026-10-23). Only in two cases:
  - **The user asks.** *Check for updates* (all apps), or a card's own *Check*.
  - **At every Durbar start**, unless it is turned off (FR-022).
    - One check per installed app, in the background. It starts only after the office is shown and the existing startup detection has finished.
    - One app at a time, so at most one package-manager process or one request at once, each with its own 30 s limit.
    - It never blocks or delays the office, a session start or Settings.
    - The result is kept in memory for the app run. Opening Settings shows it with its time and runs nothing.
    - The section's note says so: *Durbar checks for updates each time it starts* (with the switch, FR-022).

  Starting a session or opening any screen never contacts a source for this feature. The simulator never does (FR-020).

  **Failures are silent** apart from the card's status (*Could not check: …*): no toast, no dialog, and no log line with output.

  **No periodic re-check while Durbar stays open.** The owner chose start-time checking, and a timer would add contacts nobody asked for. A long-running app shows the check's time on the card, and *Check for updates* refreshes it. The draft's daily switch is withdrawn (FR-015).
- **FR-004** `[PLANNED]` **The latest version comes from the install source of the copy Durbar uses.** Where a tool exists, Durbar runs that source's own tool, with fixed argv, no shell, the `nodeExec` limits (no window, capped output, the env option and the tree kill of plan D1) and a 30 s limit per app.
  - **npm**: `npm view <package> version --json --no-update-notifier`, run with the npm that owns the copy (FR-006). `<package>` comes from the route table (`@openai/codex`, `@anthropic-ai/claude-code`, `@github/copilot`). The environment also sets `npm_config_update_notifier=false`, so npm makes no second request of its own.
  - **Homebrew**: `brew info --cask --json=v2 <cask>`, which gives `version` and, where present, `installed` and `outdated`.
    - A second run, `brew outdated --cask --json=v2 <cask>`, happens only when the first answer has no `outdated` field. `--greedy` is added only for a cask marked `auto_updates` (`copilot-cli`, research R2).
    - The cask is the one in the real path: `claude-code` follows Anthropic's stable channel, and `claude-code@latest` follows the latest one.
    - Homebrew's data is used as it is. Durbar never runs `brew update` (owner decision Q4 = A). It runs both commands with `HOMEBREW_NO_AUTO_UPDATE=1`, so Homebrew does not refresh on its own either, and it labels the answer *as Homebrew knows it*.
  - **winget**: `winget list --id <id> -e --upgrade-available --source winget`, read from the `Available` column (research R4).
    - The **background check never passes `--accept-source-agreements`**, because that would accept terms on the user's behalf.
    - When winget says its source terms are not accepted, the card shows *Could not check: winget needs its terms accepted*.
    - On an explicit *Check*, the dialog shows the terms note the way spec 051 does before an install. Only after the user's OK does that one run carry the flag.
  - **Official installer**: Durbar never runs the app's own `version` or `update` command as a probe (FR-002).
    - **Codex** and the **Copilot CLI**: a request to `https://github.com/openai/codex/releases/latest` (or `https://github.com/github/copilot-cli/releases/latest`) with redirects turned off, reading **only the `Location` header**. No body is read.
      - The location must be exactly `https://github.com/openai/codex/releases/tag/rust-v<version>` (or `…/github/copilot-cli/releases/tag/v<version>`), checked by an anchored pattern.
      - `real:` 2026-10-24: a HEAD request answered `302` with `location: https://github.com/openai/codex/releases/tag/rust-v0.164.0`, and `…/github/copilot-cli/releases/tag/v1.0.103`.
      - The API's `releases/latest` JSON is about 570 KB (measured by Paco's agent, 2026-10-24), well over the 64 KiB cap, so it is not used.
    - **Claude Code native**: both channel files on `downloads.claude.ai` are read, `/claude-code-releases/stable` and `/claude-code-releases/latest`. Each is plain text holding one version (`real:` 2026-10-24: `2.1.308` and `2.1.309`; not a documented API, research R7). The card shows both (*latest 2.1.309 · stable 2.1.308*). **`stable` decides** (owner decision Q7 = C): *Update available* (with its badge and toast) only when the installed version is below `stable`. When the installed version is at or above `stable` but below `latest`, the card shows only a quiet note, *A newer latest-channel build exists (x.y.z)*, with no chip change, no badge and no toast. Durbar does not read Claude's settings to learn the user's `autoUpdatesChannel`.
    - **Claude Code from npm** uses npm. A source with no way to ask gives *Latest: cannot be checked for this install*, never a guess.
- **FR-005** `[PLANNED]` **Strict version parsing** (review on #663: `parseVersion` is unanchored and quadratic on long digit runs, and it would take `22.11.0` out of `npm ERR! … node v22.11.0`). A version is accepted only like this:
  - Take the **structured field**: the JSON string (`npm view --json`, `brew info` `version`), the `Location` path segment, or the channel file's text after trimming. Never search free text.
  - **Cut it to 64 characters.**
  - Match **one anchored, bounded pattern**: `^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-[0-9A-Za-z.-]{1,40})?$`. Homebrew's `,build` suffix is cut at the first comma before the match.
  - Anything else gives *Could not check: unexpected answer*.

  Other rules:
  - Output is capped at 64 KiB, with ANSI and control characters removed before any parse.
  - JSON is parsed with a size cap, own properties only.
  - "Latest" is the newest **stable** version. Pre-releases count only when the installed one is a pre-release of the same line.
  - Versions are compared with `compareVersions` on the parsed parts.

  The installed version from `--version` (detection, `src/adapters/detect.ts` `parseVersion`) gets the same treatment. Durbar reads the first line only, cut to 200 characters, and takes the version token with a bounded pattern delimited by start, space, `v` or `(` before it and end, space or `)` after it. The existing detection path is fixed by PR #698 (spec 012 T133, closes #664), which this feature reuses rather than reimplements (T008).

  Tests use hostile inputs: 64 KiB of digits within a CPU-time limit (agent-notes, *measure CPU time*), the npm error line, markup, and a 65-character version. A mutation that puts the old unanchored `parseVersion` back must fail a test.
- **FR-006** `[PLANNED]` **The right tool for the copy:**
  - npm is the `npm` (or `npm.cmd`) in the same Node.js `bin` folder as the binary's real path, since version managers keep one per Node.js version. Otherwise it is the first found npm, and only when its global prefix contains the binary.
  - Homebrew is the `brew` of the prefix the binary lives under (`/opt/homebrew`, `/usr/local`, `/home/linuxbrew/.linuxbrew`).

  When no matching tool is found, the card says *Cannot check: <tool> for this copy was not found*.
- **FR-007** `[PLANNED]` The card shows:
  - *Latest x.y.z* with the source's name (*as Homebrew knows it* for Homebrew, both channels for Claude native);
  - the time of the check;
  - a chip: *Up to date*, *Update available*, *Could not check*, *Checking…* or *Not checked*.

  The state is not shown by colour alone (constitution V). The result lives in memory for the app run. Only the last announced version per app is saved (FR-016).

### Updating (US2, US3)

- **FR-008** `[PLANNED]` **Update…** appears on a card when the latest version is newer than the installed one (as well as for `too-old`, as today). It does not appear when:
  - the organization disables updates (spec 076 FR-032, FR-175);
  - the version range forbids the result (FR-188 and FR-023).

  It reuses spec 051's flow: the plan dialog lists the routes with the **owning route first and preselected** (existing `HarnessSetup.plans(kind, 'update')`), then `prepare` → native confirmation with the real path, the full argv and the target version (FR-023) → `start`. When the owning route is known, only it is offered for an update. Other routes would install a second copy, so they are hidden behind *Show other ways* with that warning.
- **FR-009** `[PLANNED]` **The updater per source** (fixed argv, no shell; table in research R6):
  - **npm**: `npm install -g <package>@<checked version> --no-update-notifier`, with the owning npm (FR-006), pinned (FR-023).
  - **Homebrew**: `brew upgrade --cask <cask>`, with `--greedy` only for a self-updating cask.
  - **winget**: `winget upgrade --id <id> -e --source winget --version <checked version>` (pinned). The agreement flags are added only after the user has seen the terms note in the dialog, as spec 051 does today.
  - **Official installer**:
    - Claude Code native: `claude update` (documented).
    - GitHub Copilot CLI: `copilot update` (documented). The dialog says that it uses the user's GitHub sign-in to ask GitHub's release API (research R7).
    - **Codex** (owner decision Q3 = C, limited, 2026-10-25: *"if it is official codex cli, it is ok"*): `codex update`, **only when the copy is the official Codex CLI**. Otherwise, and as the fallback, the official installer runs the way spec 060 FR-001 runs it: downloaded from the allow-listed hosts to a private file, size-capped, refused as root, with the native confirmation naming the URL, and `CODEX_NON_INTERACTIVE=1` set in that child's environment only, as OpenAI's own update hint does (research R3).
      - **Official means all of these** (a pure check with an injected environment; anything else is refused, and the checked 060 route is offered instead):
        - the binary's real path (symlinks resolved) lies inside an official vendor install root: `<CODEX_HOME>/packages/standalone/releases/<version>-<target>/` (default `~/.codex`; the standalone layout, research R1), or on Windows `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\` (OpenAI's `install.ps1`, spec 060 `real:` 2026-10-20). Copies from npm (`node_modules/@openai/codex/`) and Homebrew (`Caskroom/codex/`) are official too, but they update through their own route (FR-009 npm and Homebrew rows), never through `codex update`;
        - `CODEX_HOME`, when set, is an absolute path, and the root is compared after resolving it (no `..`, no link that leaves it), case-insensitive on Windows and macOS;
        - the file passes the existing `trustedPath` check (not in a folder anyone can change) and is a regular file;
        - `codex --version` (already run by detection) printed the official label `codex-cli <version>` through spec 012's bounded parse (PR #698).
        - A binary outside those roots (a fork, a self-built copy, an unknown folder) never gets `codex update`.
      - **The confirmation says plainly what runs.** *`codex update` downloads OpenAI's installer script and runs it: `sh -c "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"`*. On Windows it shows *`powershell -ExecutionPolicy Bypass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`*. It also says *Durbar cannot see or check that script; `sh`, `curl` or `powershell` come from your PATH*, with the exact command copied from `update_action.rs` at the pinned commit and kept in one constant with its `read:` source.
      - **Root**: refused as root (FR-025).
      - **Fallback**: when `codex update` is missing (an unknown-subcommand answer), says "Could not detect the Codex installation method", or fails (non-zero exit that is not FR-014 *File in use* or *Managed*), the card offers the checked 060 installer route with its own native confirmation. It never retries `codex update` by itself.
    - **Why it needs the limit** (`read:` openai/codex @970111f6 `codex-rs/tui/src/update_action.rs` (review on #663): for a standalone install it runs `sh -c "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"` (Windows: `powershell -ExecutionPolicy Bypass -c "irm …install.ps1 | iex"`), with `sh`, `curl` and `powershell` taken from `PATH`. That skips 060's host allow-list, private file, size cap and root refusal, and the confirmation could not show what runs. For an install method Codex cannot detect, it exits with "Could not detect the Codex installation method".)
  - **No elevation.** Never `sudo`, `runas` or an elevation of Durbar's own. winget may raise Windows' own UAC prompt for a machine-wide package.
  - **Root** (FR-025).
- **FR-010** `[PLANNED]` **Output.** The existing masked last-lines view: ANSI stripped, `redact()`, the OAuth mask, 200 characters per line. The full output is never logged, saved or sent. Durbar's existing time limit and Cancel for a setup step apply, with the tree kill of plan D1, so a Windows `npm.cmd` run is ended with its children and not only `cmd.exe`.
- **FR-011** `[PLANNED]` After the update, detection runs again (spec 051 FR-004). If the version did not change, or another copy is found first, the card names the copy that was updated and the one Durbar finds. Durbar does not remove or reorder copies.
- **FR-012** `[PLANNED]` A copy installed outside Durbar's routes (unknown source, distribution packages, a hand-copied binary) gets no Update. When the real path says where it came from (`/usr/bin` with a Linux distribution, `/snap/`), the card names that tool (*Update it with your system's package manager*) and offers the vendor's page.
- **FR-013** `[PLANNED]` **Open sessions** (US3, owner decision Q2 = A). The sessions that count are those whose adapter runs this app: Claude Code is the `claude` adapter, Codex is the `codex` adapter, and the GitHub Copilot CLI has none (FR-002).
  - **The update lock is taken first and held to the end.** The moment *Update…* is chosen, main takes an update lock for that app. From then until the update finishes, fails or is cancelled, no session of that adapter starts or resumes, and no queued or scheduled prompt for one is sent. A start says why. A scheduled prompt that comes due is held and listed on its card as *held: Codex is updating*, then sent when the lock is released, or reported as missed if spec 044's rules say so. Only then does main count the open sessions.
  - **When sessions are open**, the dialog says how many and offers *Update when they end* (the default), *End N sessions and update*, and Cancel. Cancel releases the lock.
  - ***Update when they end*** keeps the lock as a waiting update, shown on the card with Cancel. When the count reaches 0, the native confirmation appears again: consent is given at the moment of running, as spec 051 FR-004b requires. The waiting update is not saved across restarts.
  - ***End N sessions and update*** uses the wording of the existing *End all sessions?* dialog (`askDialog` in `src/renderer/app.js` `endAllSessions`: "N sessions end and free their places (M still working: their replies stop). The chats stay; send a message to pick up where you left off."). It adds, when there are any, the number of pending permission requests (they are denied) and of queued or scheduled prompts for those sessions (they are held, as above). Each session's running turn is interrupted first (`stopTurnOp`), then the session ends (`endSessionOp`, which does not interrupt by itself), and it stays resumable.
  - **Count again after the native confirmation.** If a session is open by then (one the lock could not stop, such as a session started from outside Durbar's own start path), the update does not start and the gate dialog comes back.
  - Durbar does not offer "update now anyway" while sessions are open.
- **FR-014** `[PLANNED]` **Failure advice** (US4). A failed check or update is classified from the exit code, the error code and the masked output, by a pure function with fixtures per source and OS:
  - *Needs administrator rights* (`EACCES`, `EPERM` on a folder Durbar does not own, Homebrew owned by another account): the command to copy, never an offer to elevate.
  - *File in use* (Windows `EBUSY`, `EPERM` on the binary, "being used by another process", winget's in-use result): name the app and ask to close it. Inside Durbar, FR-013 already prevents this.
  - *Managed by your organization*:
    - Durbar's own policy (spec 076);
    - a winget or Group Policy refusal;
    - **only on the vendor's own text that updates are disabled** (for example Claude Code's message when `DISABLE_UPDATES` or a managed setting blocks it), matched against a recorded fixture.

    `claude update` saying "up to date" is **not** *Managed*. It follows the user's channel (FR-004, Q7 = C), so the card says *Claude Code says it is up to date on its channel* and shows no toast. No retry is offered for *Managed*.
  - *Cancelled at the administrator prompt* (UAC refused).
  - *Network or source problem* (timeout, DNS, proxy, 4xx/5xx, a `Location` that does not match).
  - Otherwise *Update failed (exit N)* with the last lines and the vendor's page.

### Announcing a new version (US5)

- **FR-015** `[WITHDRAWN]` The daily switch, replaced by the start check (Q1 = C) and its opt-out (FR-022). The number is kept so later references stay stable.
- **FR-016** `[PLANNED]` A check (at start or on *Check for updates*) that finds an update:
  - marks the card and the Settings entry with a quiet *Update available* badge;
  - shows **one toast per new version** (owner decision Q5 = B): *<App> <version> is available. Open Settings > Agent apps to update.*

  The last announced version per app is saved (the version string only), so a version is announced once, also across restarts. When the user is looking at the card (*Check for updates*, or Settings open), the card is the announcement and no toast is shown, but the version still counts as announced. A failed check marks only the card, with no toast. There is no system notification. Simulator: canned answers, and a saved announced version that a driver can reset.

### Privacy, safety and platforms (all stories)

- **FR-017** `[PLANNED]` **What each start check contacts and reveals.** The README's *Safety model* and privacy text and the Settings note list this table. Per installed app, only the source of the copy Durbar uses is asked.

  Every request reveals the machine's **IP address** and the **time** to that server. None carries a Durbar identifier, the installed version or Durbar's version.

  | Install source of the copy | Contacted at each start | What it sends besides IP and time | Runs |
  |---|---|---|---|
  | npm (any app) | the registry in the user's npm configuration (default `registry.npmjs.org`) | npm's own `User-Agent` (npm and Node.js versions, OS, CPU), the package name, and **the registry token from the user's `.npmrc` if one is set for that registry** (npm sends it; Durbar never reads `.npmrc`) | one `npm view` with `--no-update-notifier` and `npm_config_update_notifier=false` (so npm makes no second request) |
  | Homebrew (any app) | nothing expected: both runs set `HOMEBREW_NO_AUTO_UPDATE=1` and Homebrew answers from its local data (Q4 = A). *Unconfirmed* that neither run contacts `formulae.brew.sh`; T042 checks it on a real Mac | n/a | up to **two** local `brew` runs (`info`, then `outdated` only if needed) |
  | winget (Claude Code, Copilot CLI) | the winget source (Microsoft's CDN; host not documented in the pages read) | winget's own client data (not documented in the pages read) | one `winget list` |
  | Codex, official installer | `github.com` (`/openai/codex/releases/latest`, redirect not followed) | `User-Agent: AgentDurbar` | one request, header only |
  | Copilot CLI, install script | `github.com` (`/github/copilot-cli/releases/latest`) | `User-Agent: AgentDurbar` | one request, header only |
  | Claude Code, native installer | `downloads.claude.ai` (`/claude-code-releases/stable` and `/latest`) | `User-Agent: AgentDurbar` | two small requests |
  | outside Durbar's routes | nothing | | |

  Durbar's own requests (the last three rows) go through **Chromium's network stack** (Electron `net.fetch` on the app's session, `redirect: 'manual'`). They therefore follow the system or organization proxy and the OS certificate store (spec 076 FR-155, FR-156), not Node's `https.get`. Each request follows FR-026's host and path allow-list, a 10 s limit, a 64 KiB cap and no credentials or cookies (`credentials: 'omit'`). The child tools (npm, brew, winget) use their own proxy settings. Durbar keeps no log of the checks and saves nothing but the announced versions (FR-016). The bundled Copilot runtime is never checked, because it updates with Durbar.
- **FR-018** `[PLANNED]` **How commands run.**
  - Every command runs as an argv array with `shell: false`, through the existing runner (`HarnessSetup` for updates, `nodeExec` for checks).
  - Arguments come only from main's fixed table, plus a package name from that table and a checked version that passed FR-005.
  - The window sends nothing except the app id and a route index (existing `runRequest`).
  - Windows `.cmd` shims (npm) run the way spec 051 already runs them: verbatim arguments through `cmd.exe` with the fixed, checked argv.
- **FR-019** `[PLANNED]` **Platforms** (constitution VI): macOS (Homebrew cask, npm, official installer), Linux (official installer, npm, Linuxbrew), Windows (winget, npm, official PowerShell installer; Scoop is detected and named but not run, [KNOWN GAP] until a route exists). Path checks use `path.win32`/`path.posix` in pure functions with an injected environment, case-insensitive on Windows and macOS. Not verified on a real Mac or Windows machine until a task records it (`[KNOWN GAP]` per platform).
- **FR-020** `[PLANNED]` **Simulator** (constitution IV): canned installed and latest versions per app and source (one up to date, one with an update, one that cannot be checked), a canned update run, simulated sessions for US3; no network, no package manager.
- **FR-021** `[PLANNED]` **No real update in tests.** `npm test` uses fixtures of each tool's output (captured from documentation or a recorded run, with the source named); a real update on a real machine is a separate, owner-approved task (it changes the user's installed app).
- **FR-022** `[PLANNED]` **Turning the start check off** (spec 076 FR-159: a feature that sends requests off the machine needs its own switch).
  - **The user's switch.** Settings > Agent apps has *Check for updates when Durbar starts*. It is **on by default** (owner decision Q6 = A), saved with the other settings as a boolean (only `false` is written). *Check for updates* (the button) always works.
  - **The organization's switch.** 076 gets the key `features.agentAppUpdateCheck: false`, which locks the user's switch off and shows *Set by your organization*. Spec 076's `updates.mode: "off"` (FR-174) also turns the start check off and locks the switch (Q6 = A). `agentApps.allowInAppInstall: false` (FR-032, FR-175) also turns the start check off and hides Update; the button stays as a read-only check. Air-gapped machines (076 FR-162) set any of these keys.
  - **Fail closed.** If the policy is present but cannot be read or validated (076's closed mode), the start check does not run, and the card says *Not checked: your organization's settings could not be read*.
  - Until spec 076's reader exists, `updatePolicy()` reads no policy and only the user's switch applies. This is stated as a `[KNOWN GAP]` and wired up in T033.
- **FR-023** `[PLANNED]` **The version that gets installed** (review on #663: `@latest`, `brew upgrade`, `claude update` and `copilot update` install whatever is newest when they run).
  - **Pin where the route can.** npm `<package>@<checked version>` and winget `--version <checked version>`.
  - **Check again right before the native confirmation.** This is a fresh check of that one app. If the latest has moved on, the dialog shows the new version and the user confirms that. If the source cannot be reached, the update is not offered.
  - **Routes that cannot pin** (Homebrew, `claude update`, `copilot update`, the official installers): the confirmation says *installs the newest version the source offers (checked: x.y.z)*.
  - **With an organization `max` (076 FR-188):**
    - only routes that can pin are offered, pinned to the checked version, and only if that version is within the range;
    - when the owning route cannot pin, the card says *Update not available: your organization limits the version, and <source> cannot install a chosen version*.
    - After any update, detection checks the range again, as spec 076 FR-189 says.
- **FR-024** `[PLANNED]` **What each updater checks before installing** (the dialog shows one line per route; review on #663):
  - **npm** checks the tarball against the `integrity` hash in the registry's metadata (npm's documented behaviour). There is no publisher signature check.
  - **Homebrew** checks the cask's `sha256` before installing (the cask JSON carries it, `read:` formulae.brew.sh/api/cask/codex.json).
  - **winget** checks the installer's SHA256 from its manifest (Microsoft's winget documentation).
  - **`claude update`**: Anthropic publishes a GPG-signed `manifest.json` with each binary's SHA256 (`read:` code.claude.com/docs/en/setup, *Binary integrity and code signing*). Whether `claude update` checks that signature itself is *unconfirmed*: the docs describe a manual check.
  - **`copilot update`**: *unconfirmed* (not documented in the pages read).
  - **The official installers** (Codex; spec 060): TLS plus Durbar's host allow-list only, with no pin or checksum by Durbar. What `install.sh` or `install.ps1` checks itself is *unconfirmed*.
  - **`codex update`** (official Codex CLI only): TLS from `curl` or `irm`, with no allow-list, cap or check by Durbar. The script's own checks are *unconfirmed*. The confirmation says so.
- **FR-025** `[PLANNED]` **Never as root.** The `isRoot` refusal (`src/main/harnesssetup.ts`, today only for `plan.script`) covers every vendor updater too: `claude update`, `copilot update` and the official installers. Message: *These updaters write into your home folder: run Agent Durbar as yourself, not as root.* npm, Homebrew and winget keep their current behaviour (Homebrew refuses root itself).
- **FR-026** `[PLANNED]` **The lookup allow-list** for Durbar's own requests (FR-004, FR-017), exact host and exact path, https only, no redirects followed:
  - `github.com` `/openai/codex/releases/latest` and `/github/copilot-cli/releases/latest`. The answer must be a 3xx whose `Location` matches FR-004's anchored pattern, and the body is not read.
  - `downloads.claude.ai` `/claude-code-releases/stable` and `/claude-code-releases/latest`. The body is at most 64 bytes of text and passes FR-005.

  The requests are made with Electron's `net.fetch` on the app session (proxy and OS certificates; spec 076 FR-155, FR-156), `credentials: 'omit'`, a 10 s limit and a 64 KiB cap. Tests: a look-alike host, an off-list path, a `Location` to another host or path, an oversized body, and a 64 KiB digit body within a CPU-time limit.

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
- **SC-002** Each Durbar start makes exactly one check per installed app, after the office is shown, and none when the user's switch is off, the policy turns it off, or the policy cannot be read; opening Settings or starting a session makes none (a test counts runner calls).
- **SC-003** No update ever starts without the native confirmation (unit test: no path reaches `start` without it, also for a waiting update).
- **SC-004** An update with open sessions of that app never runs while they are open (unit test with a fake session list).
- **SC-005** Each failure kind in FR-014 shows its own message for its captured fixture on every OS that produces it.
- **SC-006** All text meets constitution V (10.5px, state not by colour alone) at 1440x900 and 1280x800 in the simulator.
- **SC-007** The time to show the office with 15 simulated agents is not longer with the start check on than with it off (simulator driver; the check is held back until after first paint).
- **SC-008** A 64 KiB hostile answer (digits only, or a version inside an error line) is parsed within a CPU-time limit and never yields a version (FR-005).

## Assumptions

- Each source's tool prints the version in the shapes recorded in research.md; a vendor change shows up as *Could not check*, never as a wrong version.
- The user's own package-manager configuration (registry, proxy, Homebrew settings) is respected by running the user's tools rather than fetching URLs directly, except for the official route, which already fetches from fixed hosts.
- Detection's binary is the one sessions run (spec 012); updating it is what affects sessions.

## Known limits

- `[KNOWN GAP]` Not run on a real machine yet for any source; the parsers rely on documented output (`read:` in research.md) until a recorded run.
- `[KNOWN GAP]` Homebrew's "latest" is as fresh as its local data (Q4 = A: no `brew update`).
- `[KNOWN GAP]` `codex update` downloads and runs a script Durbar cannot see or check (Q3 = C, limited to the official Codex CLI; FR-009, FR-024). The *official* check is by install path, file trust and the version label, not by a code signature (not verified on macOS or Windows).
- `[KNOWN GAP]` The Claude channel files (`downloads.claude.ai/claude-code-releases/stable|latest`) are not a documented API; a change shows as *Could not check*.
- `[KNOWN GAP]` Integrity: `claude update`'s use of the signed manifest, `copilot update`'s checks and the official installers' own checks are *unconfirmed* (FR-024).
- `[KNOWN GAP]` Until spec 076's reader exists, no organization policy can turn the start check off; only the user's switch does (FR-022).
- `[KNOWN GAP]` What npm, brew and winget send beyond the table in FR-017 is their own behaviour, documented only as far as research R7 read.
- `[KNOWN GAP]` Scoop and Chocolatey copies, Linux apt/dnf/apk Claude Code packages and bun/pnpm global installs are named but not updated by Durbar (they need `sudo` or a route Durbar does not have).
- `[KNOWN GAP]` Codex has no winget route in Durbar although `OpenAI.Codex` exists in winget (research R1); a Codex installed that way is named, not updated, until a route is added.
- `[KNOWN GAP]` winget's text output (language-dependent column names) is parsed from recorded fixtures only once a Windows run records them (research R4).
- `[KNOWN GAP]` Windows ACLs are not read for the trust check (as in spec 051).

## Questions *(all answered by the owner: Q1, Q2, Q4, Q5 on 2026-10-23; Q3 asked again, Q6 and Q7 on 2026-10-25)*

- **Q1** (answered: **C**, changed from B) **When may Durbar contact the package sources?**
  - A: only when I choose *Check for updates*, plus the daily switch (off by default). *Recommended*: no surprise network use (constitution III, no telemetry), matches the request.
  - B: also once per app run when Settings > Agent apps opens.
  - C: once at each Durbar start.
- **Q2** (answered: **A**) **What does Update do while sessions of that app are open?**
  - A: offer *Update when they end* (default) or *End N sessions and update*, and Cancel. *Recommended*: never breaks a session; works on Windows, where a running program cannot be replaced.
  - B: refuse until I end them myself.
  - C: also offer *Update now anyway* on macOS and Linux (open sessions keep the old program until they end; resumed ones get the new one).
- **Q3** (answered **C** on 2026-10-23; asked again on 2026-10-24 after Paco's review of #663; **answered C, limited to the official Codex CLI**, on 2026-10-25) **For an app installed by its vendor's own installer, what runs?** New fact: `codex update` runs `curl … | sh` (Windows: `irm … | iex`) through `sh`, `curl` or `powershell` from `PATH`, which skips spec 060's allow-list, private file, size cap and root refusal (FR-009).
  - A: `claude update` and `copilot update`; Codex gets the official installer again through spec 060's checked download, with `CODEX_NON_INTERACTIVE=1`.
  - B: always the vendor's installer through spec 060's checked download, for all three apps (Durbar sees and caps every script; the apps' own updaters are not used).
  - C: as A, plus `codex update`, with the facts above shown in the confirmation (Durbar cannot show or check what the script does).
- **Q4** (answered: **A**) **May a Homebrew check refresh Homebrew's data?**
  - A: check with Homebrew's normal behaviour (its own automatic refresh of the API data, research R2) and label the answer *as Homebrew knows it*. *Recommended*: no extra side effects, honest label; `brew upgrade` refreshes anyway when it runs.
  - B: run `brew update` first on an explicit check (fresher, slower, changes Homebrew's state).
  - C: ask the vendor's public channel (npm or GitHub releases) instead of Homebrew (fresher, but the cask may lag behind, so "Update available" could be wrong).
- **Q5** (answered: **B**) **When a check finds an update, how loud?** (asked about the daily check; applies to the start check)
  - A: a quiet badge on the card and on the Settings entry only. *Recommended*: calm UI (constitution V).
  - B: also one toast per new version.
  - C: also a system notification.

- **Q6** (answered: **A**, 2026-10-25) **The user's switch *Check for updates when Durbar starts* (FR-022): its default, and whether spec 076's `updates.mode: "off"` also turns it off.**
  - A: on by default (as Q1 = C reads), and `updates.mode: "off"` also turns it off.
  - B: on by default; only `features.agentAppUpdateCheck` and `agentApps.allowInAppInstall` turn it off (`updates.mode` stays about Durbar's own updater, 076 FR-174).
  - C: off by default (the check then runs at start only for users who turn it on).
- **Q7** (answered: **C**, 2026-10-25) **Claude Code native: which channel decides *Update available* while Durbar cannot know the user's `autoUpdatesChannel`?** (Both files are read and shown, FR-004.)
  - A: the `stable` file (a user on `latest` sees *Up to date* while a newer `latest` exists; the card shows it).
  - B: the `latest` file (a user on `stable` sees *Update available* while `claude update` installs nothing).
  - C: *Update available* only below `stable`, and a separate quiet line *newer on the latest channel: x.y.z* (no toast) when between the two.

## Clarifications

### Session 2026-10-23: owner decisions (Vikram, DM to his agent, 21:44-21:47 UTC, Q1 corrected at 21:48 UTC; also posted in the team chat and on #662 / #663)

- Q1 (when are sources contacted?) → **C** (Vikram first answered B at 21:44 and changed it to C at 21:48 UTC): at **every Durbar start**, in the background, plus the explicit *Check for updates*. Consequences recorded: the check runs after first paint without delaying the office; results are kept so the badge and toast do not repeat; network failures are silent apart from the card; spec 076 policy turns it off (FR-032, FR-175); the daily switch is dropped (FR-015 withdrawn; a re-check timer would add contacts nobody asked for, and the button covers an app left open for days); the endpoints contacted at each start are listed in FR-017 for the README and privacy text. Recorded in FR-003, FR-015, FR-017, US1, US5, SC-002, SC-007.
- Q2 (open sessions on Update) → **A**: *Update when they end* (default) / *End N sessions and update* / Cancel. Recorded in FR-013, US3.
- Q3 (vendor-installer copies) → **C**: the documented updaters `claude update` and `copilot update`, plus Codex's undocumented `codex update` with a fallback to the official installer. **Re-opened on 2026-10-24** (below).
- Q4 (Homebrew refresh) → **A**: no `brew update`; Homebrew's current data, labelled *as Homebrew knows it*. Recorded in FR-004, Edge Cases.
- Q5 (how loud is a found update) → **B**: a quiet badge on the card and the Settings entry, plus one toast per new version. Recorded in FR-016, US5.

### Session 2026-10-24: Paco's review of #663 (changes requested, 15 items)

- Q3 is asked again with the new fact that `codex update` runs `curl | sh` (FR-009). Until the answer, the spec uses the official route with `CODEX_NON_INTERACTIVE=1`.
- New open questions: Q6 (the start-check switch's default and `updates.mode`), Q7 (which Claude channel decides).
- Folded in:
  - the Codex and Copilot latest version read from the `Location` header (FR-004, FR-026);
  - strict version parsing, the detection path included (FR-005, issue #664);
  - the opt-out switch, with the organization key failing closed (FR-022);
  - Chromium's network stack for Durbar's requests (FR-017, FR-026);
  - FR-017 made complete (IP, time, `User-Agent`, npm's token and notifier, two brew runs), and the Copilot version read from files (FR-002);
  - winget without auto-accepted terms (FR-004);
  - pinning and a re-check before the confirmation, with routes limited under `max` (FR-023);
  - both Claude channel files, and *Managed* only on the vendor's own text (FR-004, FR-014);
  - the update lock held from the count to the finish, plus a re-count (FR-013);
  - the *End all sessions?* wording, with an interrupt first (FR-013);
  - root refused for every updater (FR-025);
  - integrity per updater (FR-024);
  - the `nodeExec` env option and tree kill (plan D1).

### Session 2026-10-25: owner decision on Q3 (Vikram, 00:07 UTC, after Paco's finding)

- Q3 → **C, limited**: *"if it is official codex cli, it is ok"*. Durbar may run `codex update` only when the copy is the official Codex CLI: a real path inside OpenAI's standalone layout or its Windows install root, `trustedPath`, and the official `--version` label. Unknown or forked binaries are refused.
- The confirmation says plainly that `codex update` downloads and runs OpenAI's installer script (`curl | sh`, `irm | iex`) and shows the exact command.
- The root refusal applies (FR-025).
- A missing or failing `codex update` falls back to the checked spec 060 installer route.
- Recorded in FR-009 and Known limits, plan D3, and tasks T020-T021.

### Session 2026-10-25: owner decision on Q6 (Vikram, 00:09 UTC)

- Q6 → **A**: the user's switch *Check for updates when Durbar starts* is **on by default**. Any of these turns the start check off:
  - spec 076's `updates.mode: "off"`, which also locks the switch;
  - the feature key `features.agentAppUpdateCheck: false`;
  - `agentApps.allowInAppInstall: false`;
  - an unreadable policy (fail closed).
- Recorded in FR-022, plan D6, and tasks T007, T011 and T033.

### Session 2026-10-25: owner decision on Q7 (Vikram, 00:10 UTC)

- Q7 → **C**: for Claude Code native, *Update available* only when the installed version is below `stable`. When a newer `latest` exists, a quiet note (*A newer latest-channel build exists*) appears, with no badge and no toast. Recorded in FR-004, FR-014, plan D4, and tasks T010, T013 and T034.

## Changes

(none yet)

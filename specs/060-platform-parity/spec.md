# Spec 060: Platform parity: install, find and run agent apps on macOS, Windows and Linux

**Status:** clarified 2026-10-20 (owner answered Q1-Q6, see *Clarifications*); being built in the order of Q6.
**Owner request (2026-10-20):** "brew does not work on windows, also for linux, and on macos what if brew is not installed? Look at all such things which are platform specific, look at the full code and specs and research, and come up with a plan."
**Builds on:** 008 (packaging, CI), 012 (adapters, detection), 045 (Windows `.cmd` shims), 051 (harness setup), 052 (Mac title bar, shortcuts), 040/041 (secrets).

## Facts

- **Homebrew is not part of macOS.** A fresh Mac has no `brew`, no `node` and no `npm`. Windows has no Homebrew. On Linux, Homebrew (Linuxbrew) is rare. Most Linux desktops have neither `brew` nor a recent Node.
- **Every vendor now has an official installer that needs no package manager** (`read:` vendor docs, 2026-10-20):
  - **Claude Code:** `install.sh` on macOS and Linux; `install.ps1` (PowerShell) and `install.cmd` on Windows. Anthropic calls the npm package deprecated. On Windows, Git for Windows is *recommended* (for the Bash tool); without it Claude uses PowerShell for shell commands.
  - **GitHub Copilot CLI:** an install script for macOS and Linux (`gh.io/copilot-install`, installs to `~/.local` for a normal user), winget on Windows, Homebrew, and npm (Node 22+). On Windows it needs **PowerShell 6 or later**.
  - **OpenAI Codex:** `install.sh` on macOS and Linux and `install.ps1` on Windows (from `releases.openai.com/codex`, falling back to GitHub Releases), Homebrew, npm, and release archives per platform. OpenAI calls Windows experimental and suggests WSL.

## Audit: what the code does today

| # | Area | Today | Gap | Severity |
|---|---|---|---|---|
| A1 | Install routes (`src/shared/harnesssetup.ts`) | Windows: winget, then npm. macOS: Homebrew, then npm. Linux: Homebrew, then npm (Codex: npm only). | A Mac without Homebrew and Node, or a Linux desktop without them, gets **no install route**, only "open the vendor's page". The vendors' own installers are never offered. Claude's first route on Mac and Linux is Homebrew, although Anthropic's recommended route is its native installer. | **High** |
| A2 | Simulator setup data (`src/renderer/sim.ts:1366`) | Returns Homebrew plus npm on every OS, and Claude's Homebrew cask even for Copilot. | Screenshots from Windows and Linux CI show Homebrew (seen by the owner). The simulator does not use `installPlans()`. | **High** (misleading) |
| A3 | Finding an installed app (`src/adapters/detect.ts`) | `PATH` plus fixed folders: macOS `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.claude/local`, `~/.npm-global/bin`; Windows `~/.local/bin`, `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\<name>`, winget Links; Linux `~/.local/bin`, `~/.claude/local`, `/usr/local/bin`, `/usr/bin`, `~/.npm-global/bin`. | An app opened from Finder, the Dock, the Start menu or a desktop launcher does **not** get the user's shell `PATH`. CLIs installed with npm under **nvm, fnm, volta, asdf or mise**, or through Linuxbrew (`/home/linuxbrew/.linuxbrew/bin`, which only the setup screen knows), are not found. They show as "not installed" although the terminal finds them. | **High** |
| A4 | Windows prerequisites | A PowerShell 7 hint for Copilot (`harnesses.js`); Codex's elevated sandbox check (`codexModes.ts`). | No check, before install or sign-in, that **PowerShell 6+** exists (Copilot), or whether **Git for Windows** exists (Claude's Bash tool; without it Claude uses PowerShell, which changes what an agent's commands look like). | Medium |
| A5 | Windows and WSL | Codex runs natively, with the elevated-sandbox requirement. | OpenAI suggests WSL for Codex on Windows; Durbar cannot use a CLI installed inside WSL. This needs to be explained, not hidden. | Medium |
| A6 | Linux packaging (`package.json` build) | AppImage, x64 only. README: `chmod +x` and `--no-sandbox`. | **AppImage needs `libfuse2`**, missing by default on Ubuntu 22.04 and later: the app does not start ("libfuse.so.2"). No `.deb`/`.rpm` and no arm64 build. | **High** for Linux users |
| A7 | Windows packaging | NSIS and portable builds, x64, unsigned. | No arm64 build (Windows on ARM laptops run x64 under emulation). The SmartScreen and Edge warnings are documented in the README. | Low |
| A8 | macOS packaging | dmg and zip, arm64 and x64, unsigned, no notarization. README explains the `xattr` command. | Fine as documented while unsigned; signing needs money (owner). | Low (known) |
| A9 | Secrets on Linux | MCP secrets are refused when Electron falls back to `basic_text` (no keyring). | The user is told in the app, but the README does not say that a Linux desktop without a keyring (GNOME Keyring or KWallet) cannot store MCP secrets. | Low (docs) |
| A10 | Folder identity | Folders are stored by path as given. | macOS and Windows file systems are case-insensitive: `/Users/a/Proj` and `/users/a/proj` can become two folders. Windows short names, drive-letter case and a trailing `\` likewise. | Medium |
| A11 | Shortcuts and title bar | Cmd on Mac, Ctrl elsewhere (FR-084); Mac title bar rules (FR-138). | Done. CI now drives Cmd on macOS (spec 008). | Done |
| A12 | Processes | No shell for spawns; Windows `.cmd` shims go through `cmd.exe` with checked arguments (spec 045); `taskkill /T` on Windows. | Done. | Done |
| A13 | CI coverage | Spec 008 FR-090..FR-093 (PR #389): UI checks on macOS, Windows and Linux runners. | The install and detection paths (A1, A3) have no test that runs on each OS's real file layout. | Medium |

## Requirements (to build after the owner's answers)

- **FR-001 Official installers as a route** (A1). On every OS, Durbar offers the vendor's official installer: Claude `install.sh`/`install.ps1`, Copilot's install script (macOS/Linux) or winget, Codex `install.sh`/`install.ps1`. It is listed first where the vendor recommends it (Claude everywhere), and needs neither Homebrew nor Node.
  - **Safety (constitution III):** no `curl … | bash` string. Durbar downloads the script over HTTPS from the vendor's fixed host to a private temp file, shows the exact host and command, and runs it only after the user clicks **Install**, with the interpreter and file as an argument array (`bash <file>`; `powershell -NoProfile -ExecutionPolicy Bypass -File <file>`). There is no user-controlled string, and the temp file is deleted after. A host or redirect outside the vendor's fixed list is refused.
  - Homebrew and winget stay as routes when found; npm stays last and labelled.
- **FR-002 Simulator truth** (A2). The simulator's setup data comes from `installPlans()` for the window's platform and a realistic set of found managers (Windows: winget; macOS: none, so the official installer; Linux: none). Screenshots show what each OS really offers.
- **FR-003 Find apps where users install them** (A3). Detection also looks in: Linuxbrew (`/home/linuxbrew/.linuxbrew/bin`, `~/.linuxbrew/bin`); `~/.nvm/versions/node/*/bin` (newest first), `~/.fnm` and `~/.local/share/fnm` node versions, `~/.volta/bin`, `~/.asdf/shims`, `~/.local/share/mise/shims`; on Windows `%LOCALAPPDATA%\Volta\bin` and `%APPDATA%\nvm`. Optional (Q2): read the login shell's `PATH` once (`$SHELL -ilc` with a fixed command, no user input, a time limit). The settings screen says where each app was found.
- **FR-004 Windows prerequisites** (A4). (The README says Copilot needs PowerShell **7**; GitHub's docs say **6 or later**: correct the README.) Before installing or signing in to Copilot, check for PowerShell 6+ (`pwsh.exe`) and offer `winget install Microsoft.PowerShell`. For Claude, say whether Git for Windows was found and what changes without it (shell commands run in PowerShell), and offer `winget install Git.Git`.
- **FR-005 WSL** (A5). Codex on Windows: explain the experimental status and that a Codex inside WSL is not used by Durbar; link OpenAI's page. Not built: running agents inside WSL (Q4).
- **FR-006 Linux packaging** (A6). The README gains the keyring note (A9) and the `libfuse2` step (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on 22.04) and the AppImage `--appimage-extract-and-run` fallback. Q3: add a `.deb` and arm64 builds.
- **FR-007 Folder identity** (A10). On macOS and Windows, two paths that differ only in case, or (Windows) in short names or a trailing separator, are the same folder: compared through `fs.realpathSync.native` and a case fold. Migration: existing duplicates are merged on load and their sessions kept.
- **FR-008 Tests per OS** (A13). Unit tests for the routes and detection folders on all three platforms (pure functions, fake file systems); the UI workflow (spec 008) shows the setup screen on each runner with the real `installPlans()`; one real install check per OS on a clean machine or CI runner (Q5).

## Questions for the owner

- **Q1** Running the vendor's install script from Durbar (FR-001, with the safety rules above): yes, or only show the command for the user to paste? *Recommended:* yes, with the exact command shown first.
- **Q2** Read the login shell's `PATH` (FR-003) in addition to the fixed folders? It finds every setup, but it runs the user's shell profile once. *Recommended:* yes, with a 3 s limit, falling back to the fixed folders.
- **Q3** Linux: add `.deb` and arm64 (Linux and Windows) builds? *Recommended:* `.deb` x64 now; arm64 after a real arm64 check.
- **Q4** Windows: support Codex inside WSL later, or explain only? *Recommended:* explain only for now.
- **Q5** Real install checks: on GitHub runners (clean macOS, Windows and Linux; no account needed for install and detection) in a manual workflow? *Recommended:* yes; sign-in stays on real machines.
- **Q6** Order of work. *Recommended:* FR-002 (simulator truth) and FR-006 (libfuse2 docs) first (small); then FR-001 and FR-003 (the real gap); then FR-004, FR-007 and FR-008.

## Clarifications (owner, 2026-10-20)

- **Q1 → least privilege first.** "Go with the least admin rights path first and then higher towards needing admin rights, as not everyone has admin rights on their machine." So FR-001's order per OS is:
  1. the vendor's official **user-level** installer (into the home folder, no admin: Claude `install.sh`/`install.ps1`, Copilot's script into `~/.local`, Codex `install.sh`/`install.ps1`);
  2. npm, **only when its global prefix is writable by the user** (otherwise it is listed last with "needs administrator rights");
  3. winget and Homebrew, labelled "may ask for administrator rights".

  Every route says before it runs whether it can ask for admin rights. Durbar itself never asks for elevation.
- **Q2 → yes**: read the login shell's `PATH` once (fixed command, time limit, fall back to the fixed folders).
- **Q3 → yes**: `.deb` and arm64 builds (Linux arm64, Windows arm64, next to the macOS arm64 that exists), each recorded as unverified until a real check.
- **Q4 → native Windows, explain WSL.** The owner asked whether Codex needs WSL. It does not: Codex runs natively on Windows (PowerShell), and Durbar already supports that (spec 012 FR-145; the one Windows need is Codex's elevated sandbox for Read-only and Ask first, which Durbar checks). OpenAI only *recommends* WSL as more stable. FR-005 is text only: native is the path, and a Codex inside WSL is not used by Durbar.
- **Q5 → yes**: real install and detection checks on clean GitHub runners (no account).
- **Q6 → as listed**: simulator truth and Linux docs first, then installers and detection, then the rest.

## Changes

### 2026-10-20: T010 built (simulator truth, Linux docs)

- **FR-002** `[IMPLEMENTED]`. Under the simulator, main answers `harness:plans` with the real `installPlans()` for this OS and a per-OS set of found managers (`SIM_FOUND`: Windows winget; macOS and Linux none, a typical new machine), or `DURBAR_SIM_MANAGERS` for a driver that needs the command dialog; `sim.ts` asks main and keeps its made-up list only for a plain browser. So the Windows screenshot offers winget, never Homebrew, and a new Mac or Linux desktop shows the vendor page until FR-001 adds the official installers. test: `test-harnesssetup` (per-OS sets, no Homebrew on Windows or Linux, the assumed set does not look at the machine, the override parser). sim: `shots-051-setup` with `DURBAR_SIM_MANAGERS=winget,brew,npm` asserts the first route per OS and that no other OS's manager is offered.
- **FR-006 (docs)** `[IMPLEMENTED]`: README Linux: FUSE 2 (`libfuse2t64` / `libfuse2`, `--appimage-extract-and-run`) and the keyring note (A9). The Copilot line says PowerShell 6 or later (GitHub's docs), not 7.

### 2026-10-20: T020 design (FR-001, official installers, least privilege first)

- **Routes, in order** (Q1: least admin first; a deprecated route is always last):

  | Agent app | Windows | macOS | Linux |
  |---|---|---|---|
  | Claude Code | official `install.ps1` → winget → npm (deprecated) | official `install.sh` → Homebrew → npm (deprecated) | official `install.sh` → Homebrew → npm (deprecated) |
  | Copilot CLI | npm (user folder, no admin) → winget | official script → npm → Homebrew | official script → npm → Homebrew |
  | Codex | official `install.ps1` → npm | official `install.sh` → npm → Homebrew | official `install.sh` → npm |

  Each route says what it needs: official is "installs into your home folder, no administrator rights"; npm on macOS and Linux is "no administrator rights" only when the found `npm` is inside the home folder (nvm, fnm, volta), otherwise "may need administrator rights (system Node)"; winget and Homebrew are "may ask for administrator rights".
- **The official route** is offered whenever its interpreter exists (`bash` on macOS and Linux; Windows PowerShell 5.1, `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, which every Windows 10/11 has). The confirmation names the URL, the interpreter and "no administrator rights".
- **Download** (main process, only after the user confirms): HTTPS GET of the documented URL; at most 3 redirects, each to an allowed host for that vendor (Claude `claude.ai`, `downloads.claude.ai`; Copilot `gh.io`, `raw.githubusercontent.com` with a path under `/github/copilot-cli/`; Codex `chatgpt.com`, `releases.openai.com`), else refused; at most 1 MB; 30 s limit; written to a new private temp folder (`0700`, file `0600`). The script then runs as `bash <file>` or `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <file>` through the existing runner (argv, no shell, the same 15-minute limit, progress and cancel), and the folder is deleted when it ends. Durbar never adds `sudo`, and refuses the official route when it runs as root (uid 0). What the script downloads is checked by the script itself (SHA-256, research.md).
- `[KNOWN GAP]` until T060: the routes run on real machines only through the CI install workflow (with and without admin, Q5).

### 2026-10-20: T020 built (official installers, least privilege first)

- **FR-001** `[IMPLEMENTED]` as designed above: route `official` (shared `ROUTES`, `SCRIPTS`), interpreter as a found manager (`bash`; Windows PowerShell from `%SystemRoot%` only), `src/main/officialinstall.ts` (allow-list per hop, 3 redirects, 1 MB, 30 s, private folder), `HarnessSetup.withScript` (download after the main-side confirmation, appended as the last argument, folder deleted when the run ends or fails to start), refused as root, the native confirmation names the URL, the hosts and "no administrator rights". npm on macOS/Linux says "may need administrator rights" when the found `npm` is outside the home folder. test: `test-officialinstall` (allow-list incl. look-alike hosts and the Copilot path prefix, redirect refusal before any fetch from a foreign host, redirect limit, HTTP errors, empty and oversized bodies, 0700/0600, bash argv, cleanup, root refusal, Windows PowerShell from the system folder only), `test-harnesssetup` (route order per OS with and without the interpreter, admin notes, scripts also update). sim: screenshots `060-install-official-*`. `[KNOWN GAP]` not run on a real machine yet: T060.

### 2026-10-20: T060 tooling (real install check on clean runners, standard user and admin)

- `scripts/install-check.ts`: on the machine it runs on, installs each agent app through **every** route Durbar offers there, with the app's own `HarnessSetup` (plans → official download → argv run), then checks that detection finds it and `--version` runs; prints a Markdown table and writes JSON. Never meant for a person's own machine.
- Workflow **Install check** (`.github/workflows/install-check.yml`): ubuntu, macOS and Windows runners; first as a new **standard user** without admin rights (Linux `useradd`, macOS `sysadminctl`, Windows `New-LocalUser` with `Start-Process -Credential`), then as the runner's admin user; both tables in the job summary, JSON as an artifact (30 days). Manual, or on a PR that changes the install code. No account, no sign-in, no AI.


### 2026-10-20: T060 first results (real, GitHub runners, run on #393)

`real:` every route Durbar offers, installed for real through `HarnessSetup`. A standard user has no admin rights; the admin user is the runner's own account.

| Route | macOS standard / admin | Linux standard / admin | Windows standard / admin |
|---|---|---|---|
| **official**, Claude | ok / ok (2.1.304) | ok / ok | CI temp folder error (fixed in the check) / ok |
| **official**, Copilot | ok / ok (1.0.101) | ok / ok | not offered (npm first, as designed) |
| **official**, Codex | ok / ok (0.163.0) | ok / ok | CI temp folder error / **fail** → fixed, see below |
| npm (all three) | **fail** (exit 243, global Node.js) / ok | ok (runner's Node.js is writable) / ok | ok / ok (`C:\npm\prefix`) |
| Homebrew (all three) | **fail** (exit 1, Homebrew belongs to the admin) / ok | **fail** (exit 1) / ok | not offered |

Findings, fixed in the same PR:

- **Codex official on Windows failed even as admin.** OpenAI's `install.ps1` runs `tar -xzf C:\...`. On the runner, Git's GNU tar (`Git\usr\bin`) comes first on PATH and reads `C:` as a remote host, so the package was "missing". Durbar now runs an official installer on Windows with `%SystemRoot%\System32` first on PATH, as Windows orders it, so Windows' own `tar.exe` is used (`setupEnv`, unit test). This can happen on a user's machine too, wherever Git's `usr\bin` is on PATH.
- **Homebrew from a standard user** fails outright. The old note, "may ask for administrator rights", was wrong. When the found `brew` belongs to another account, the route now says "Homebrew on this computer belongs to another account, so it will not work from yours" (unit test).
- **npm from a standard user** on macOS failed, as the existing note says ("Node.js is installed for all users here, so this may need administrator rights"). The official route comes first, so nothing changes.
- **Windows standard-user TEMP** (CI only): the user started from the admin account inherited its TEMP. `install-check.ts` now uses the user's own profile folder.
- Harmless: Copilot's `install.sh` offers to edit the shell profile and reads `/dev/tty`. With no terminal it prints `/dev/tty: Device not configured`, answers no, and completes. Durbar finds the binary in `~/.local/bin` anyway.
- In the check's table, *Found at* is what detection finds after that route ran, which can be an earlier route's binary. *Result* uses the route's own exit code.

Rerun after those fixes (run 39485719890, `d600c68`): `real:` **Codex official on Windows now installs as admin** (0.163.0), so the PATH fix works. macOS and Linux: same as before. Windows standard user: npm ok for all three; official failed for two more reasons, both fixed:

- **Claude** `install.ps1`: `Get-FileHash` not found. Windows PowerShell 5.1 started from PowerShell 7 inherits 7's `PSModulePath` and cannot load its own modules. This also happens on a user's machine when Durbar is started from a PowerShell 7 terminal. An official installer now runs without `PSModulePath`, so 5.1 builds its default (`setupEnv`, unit test).
- **Codex** `install.ps1`: access denied on the admin's `AppData\Local` (CI only: the test user inherited `LOCALAPPDATA`). `install-check.ts` now sets the user's own `APPDATA` and `LOCALAPPDATA`.

`real:` 2026-10-20, spec 062's first e2e run (Windows runner): after OpenAI's official `install.ps1` succeeded, **detection said Codex was not installed**. The script installs to `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`, but detection looked in `%LOCALAPPDATA%\Programs\codex`. Detection now also looks in OpenAI's folder (unit test).

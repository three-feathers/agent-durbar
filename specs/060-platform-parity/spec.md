# Spec 060: Platform parity: install, find and run agent apps on macOS, Windows and Linux

**Status:** draft, audit and plan; waiting for the owner's answers to Q1-Q6 before any code.
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

## Changes

### 2026-10-20: T030 built (FR-003, owner Q2: yes)

- **FR-003** `[IMPLEMENTED]`:
  - **Search order** in `candidates()` (`src/adapters/detect.ts`):
    1. the configured path;
    2. `PATH`;
    3. the **login shell's `PATH`** (macOS and Linux);
    4. the fixed folders as before;
    5. then the version managers: nvm (`$NVM_DIR` or `~/.nvm/versions/node/*/bin`, newest version first), fnm (`$FNM_DIR`, `~/.fnm`, `~/.local/share/fnm` and, on macOS, `~/Library/Application Support/fnm`; the `aliases/default` link first, then `node-versions/*/installation/bin`), Volta, asdf and mise shims, and Linuxbrew on Linux. On Windows: `%LOCALAPPDATA%\Volta\bin`, `NVM_SYMLINK`, and nvm-windows' version folders (`NVM_HOME` or `%APPDATA%\nvm`).

    Entries are deduplicated (case-insensitively on Windows). Version folders are read through `DetectEnv.listDir` (folder names only, at most 200 read and 20 used).
  - **Login shell** (`src/main/loginpath.ts`), read once per app run before the first detection, never under the simulator:
    - the shell is `$SHELL` only when it is an absolute, existing bash, zsh, fish, sh, dash or ksh, otherwise `/bin/sh`;
    - the command is a constant `printf` between markers;
    - argv only, stdin closed, its own process group, killed after 3 s;
    - at most 64 KB read, 8 KB of `PATH`, 64 absolute folders;
    - any failure gives an empty list.

    Main hands the list to detection with `setLoginPath`; adapters never spawn a shell.
    Main also adds those folders after its own `PATH` (`mergeLoginPath`, no duplicates), so what detection finds also runs. An npm-installed agent app in an nvm or fnm folder is a `#!/usr/bin/env node` script; its `--version` probe, its sessions and MCP servers such as `npx` need that folder's `node` on PATH (review finding on #398).
  - **Where it was found:** `DetectResult.where` / `AdapterInfo.where` is the `displayPath` of the found binary: `~/…` under the home folder, otherwise only the file name, never the user name. The Agent apps card shows "Found at …" for an installed app (`shots-051-setup` asserts it; screenshots `051-harnesses-*`).
- `test:` `scripts/test-detect.ts`: the folders per OS, newest-first order, dedupe, an unreadable folder, relative entries, the shell choice and fallbacks, the parser (markers, junk, caps) and the runner with a fake spawn (output, timeout, error, nothing on Windows).
- `[KNOWN GAP]`:
  - not run on a real macOS GUI launch (Finder or Dock), where the login-shell `PATH` matters most;
  - the Windows nvm-windows and Volta folders are unit-tested only;
  - a login profile that waits for input simply times out after 3 s, and detection then uses the fixed folders.

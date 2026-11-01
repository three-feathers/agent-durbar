# Install

Requirements, downloads, verifying a download, the first-run steps for each system and the Mac notes. Moved out of the [README](../README.md) on 2026-10-31 so the README stays short (spec 021 FR-065); the text is unchanged except for its links.

## Install

**Requirements**
- At least one agent app: GitHub Copilot (a free plan works), Claude Code, or OpenAI Codex. **Settings > Agent apps** can install it, least administrator rights first: the vendor's **official installer** (into your home folder, no admin; downloaded only from the vendor's own address), then npm, then winget or Homebrew (which may ask for admin), with the command shown first, and sign you in with the vendor's own page and a one-time code. Or install and sign in yourself, for example with `copilot login`. Durbar finds an agent app on your `PATH`, on your login shell's `PATH` (macOS and Linux, read once at start, at most 3 s), in the usual install folders, and in the folders of Node.js version managers (nvm, fnm, Volta, asdf, mise; nvm-windows and Volta on Windows) and Linuxbrew. Settings shows where it was found. Version detection reads only a bounded token on the first output line; malformed output or error prose leaves the app version unknown (offline regression tests; this parser change has not been checked against installed agent apps).
  - **Windows:** Durbar offers the official PowerShell installer (Claude Code, Codex), npm, and winget (Claude Code, Copilot). Choose a route and **Install**, or **Run** beside the vendor's command: Durbar runs it for you after showing the exact command (the PowerShell installers are downloaded from the vendor and run with Windows PowerShell; Copilot's winget route needs no Node.js). Prefer to install yourself? Each command also has a **Copy** button, for example in PowerShell `winget install GitHub.Copilot`, `irm https://claude.ai/install.ps1 | iex` or `winget install Anthropic.ClaudeCode`, and `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"` for Codex (OpenAI publishes no winget package). Then choose **Check again** ([screenshot](screenshots/051-install-manual-win32-1440x900.png), simulator). Durbar itself is not on winget yet: download it from the release page below.
  - Not tried yet: installs through winget or Homebrew, the official installers on a real machine, and the flows on macOS and Windows (a manual CI check on clean macOS, Windows and Linux machines, with and without admin rights, is spec 060 T060).
- Durbar never sees, stores or sends your tokens: each harness reads its own sign-in. Durbar has no accounts, no servers and no telemetry.
- Usage bills against **your** plans. Several agents in parallel can use credits quickly; see [Costs and caps](safety.md#costs-and-caps).
- Optional: VS Code, VS Code Insiders or VSCodium, for *Open in VS Code*.

**Download** the build for your system from the [Releases page](https://github.com/three-feathers/agent-durbar/releases). Check it against `SHA256SUMS.txt`. There is no auto-update: download a newer release to update.

| System | File |
| --- | --- |
| macOS, Apple Silicon | `Agent-Durbar-<version>-arm64.dmg` (or `.zip`) |
| macOS, Intel | `Agent-Durbar-<version>-x64.dmg` (or `.zip`) |
| Windows 10/11, x64 | `Agent-Durbar-Setup-<version>.exe` or `Agent-Durbar-<version>-portable.exe` |
| Linux, x64 | `Agent-Durbar-<version>-x86_64.AppImage` |

**Verify a download.** From the next release on, every file on the Releases page (and `SHA256SUMS.txt`) carries a build provenance attestation made by this repository's release workflow. With the GitHub CLI (`gh`): `gh attestation verify <file> --repo three-feathers/agent-durbar`. It succeeds only for a file built by that workflow in this repository. Then compare the file's SHA-256 with its line in `SHA256SUMS.txt` (`sha256sum -c --ignore-missing SHA256SUMS.txt` on Linux, `shasum -a 256 -c --ignore-missing SHA256SUMS.txt` on macOS, `Get-FileHash` on Windows). Releases before that have only the checksums. This proves where a file was built, not that the app is free of bugs; the builds are still unsigned (below).

**The builds are not code-signed** (certificates cost money), so your OS warns you the first time. Only open files from this repository's Releases page.
- **macOS:** right-click the app and choose **Open**, or allow it in System Settings > Privacy & Security. If macOS says it is damaged, run `xattr -dr com.apple.quarantine "/Applications/Agent Durbar.app"`.
- **Windows:**
  - Which file: `Agent-Durbar-Setup-<version>.exe` installs to the Start menu; `Agent-Durbar-<version>-portable.exe` runs without installing.
  - Edge may block the download ("isn't commonly downloaded"): open Downloads (**…**), choose **Keep**, then **Show more > Keep anyway**.
  - Check the file in PowerShell: `Get-FileHash .\Agent-Durbar-Setup-<version>.exe -Algorithm SHA256` and compare the hash with the line for that file in `SHA256SUMS.txt`.
  - On "Windows protected your PC", click **More info**, then **Run anyway**.
  - The Copilot CLI needs PowerShell 6 or later (GitHub's docs, not checked by us); Windows only ships 5.1. If the Copilot card says so, install it with `winget install --id Microsoft.PowerShell -e`.
- **Linux:** run `chmod +x Agent-Durbar-*.AppImage && ./Agent-Durbar-*.AppImage`. The AppImage's launcher entry no longer forces `--no-sandbox`; its `AppRun` adds the switch by itself only on systems without unprivileged user namespaces (you can also add it by hand).
  - An AppImage needs FUSE 2. Ubuntu 22.04 and later do not install it: if the app does not start ("libfuse.so.2" / "dlopen()"), run `sudo apt install libfuse2t64` (Ubuntu 24.04 and later) or `sudo apt install libfuse2` (22.04), or start it without FUSE: `./Agent-Durbar-*.AppImage --appimage-extract-and-run`.
  - Saved MCP secrets need a desktop keyring (GNOME Keyring or KWallet). Without one, Durbar refuses to store them rather than keep them with a fixed key (spec 019): add a keyring, or pass secrets through the server's own environment.

**On a Mac** (spec 052 FR-083..FR-086; tried on real Macs, macOS 26 on Apple Silicon, and fixed after those runs: moving the window from an open chat, the traffic-light room, question cards and the chat strip):
- Shortcuts use ⌘ and are shown that way: ⌘K command palette, ⌘F Go to, ⇧⌘A (or ⌘A outside text) the Needs you inbox, ⌘⌫ back to the office (outside text), ⇧⌘N the next agent, ⇧⌘S Schedules. In a chat that waits for you, ⌥⌘A / ⌥⌘S / ⌥⌘D answer and ⌥⌘N goes to the next agent (Option alone types accents on a Mac). macOS itself uses ⌥⌘D to show or hide the Dock, so Deny may not reach Durbar with the keys; click it instead.
- **Agent Durbar > Settings…** (⌘,) opens Settings; the menu also has Edit, View (zoom, full screen), Window and Help.
- Closing the window hides it and **your agents keep running**; click the Dock icon to bring it back. Quit with ⌘Q.
- The title bar is hidden: you move the window by dragging the top bar (in a chat, the agent strip, a notice strip or a screen's header at the top). While a dialog or the command palette is open the window does not drag. These areas were fixed after a real-Mac report and are checked in the simulator (`npm run check:mac-titlebar`); double-click to zoom and full screen have not been checked on a real Mac yet.
- On Windows and Linux the window has no menu bar (no Reload or developer tools); copy and paste in text fields work as usual.

> **Trying it on Windows?** Durbar is built, started and end-to-end checked on Windows in CI (9 of 9 on 2026-10-20), and the owner tried it on a real Windows PC with a colleague once (2026-10-21; [#467](https://github.com/three-feathers/agent-durbar/issues/467): Settings > Agent apps offered no install option, fixed in [#469](https://github.com/three-feathers/agent-durbar/pull/469)). It has not been used there day to day. If something does not work (the download, the installer, Settings > Agent apps, a harness that is not found), please [open an issue](https://github.com/three-feathers/agent-durbar/issues) with your Windows version and what you saw.

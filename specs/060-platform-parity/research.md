# Research 060: the vendors' official installers (for FR-001)

`read:` 2026-10-20. Each script was downloaded and **read, never run**, from the URL the vendor documents. Facts below are from the script text; recheck when a vendor changes its script.

| Vendor | Script (documented URL) | Installs to | Admin rights | Integrity | Hosts it contacts |
|---|---|---|---|---|---|
| Claude Code (macOS, Linux) | `https://claude.ai/install.sh` | `$HOME/.claude` (downloads) and `~/.local/bin` | **No.** It refuses to run under `sudo` unless `CLAUDE_INSTALL_ALLOW_SUDO=1` | SHA-256 from the release manifest | `claude.ai`, `downloads.claude.ai` |
| Claude Code (Windows) | `https://claude.ai/install.ps1` | `%USERPROFILE%\.claude` | No (no elevation in the script) | SHA-256 (`Get-FileHash`) | `downloads.claude.ai` |
| GitHub Copilot CLI (macOS, Linux) | `https://gh.io/copilot-install` → `raw.githubusercontent.com/github/copilot-cli/refs/heads/main/install.sh` | `$PREFIX/bin`; **`$HOME/.local` for a normal user**, `/usr/local` as root | No as a normal user | SHA-256 against `SHA256SUMS.txt` when `sha256sum`/`shasum` exists (it only warns when neither exists) | `gh.io`, `raw.githubusercontent.com`, `github.com` releases (and its download CDN) |
| GitHub Copilot CLI (Windows) | none (winget `GitHub.Copilot`, or npm) | winget's package folder | winget **may** ask (depends on the package's scope) | winget's own hash check | winget source |
| OpenAI Codex (macOS, Linux) | `https://chatgpt.com/codex/install.sh` | `${CODEX_INSTALL_DIR:-$HOME/.local/bin}` | No | SHA-256 (`codex-package_SHA256SUMS` or the GitHub asset digest) | `chatgpt.com`, `releases.openai.com`, `api.github.com`, `github.com` |
| OpenAI Codex (Windows) | `https://chatgpt.com/codex/install.ps1` | under `%USERPROFILE%` (`.codex`) | No (no elevation in the script) | SHA-256 (SHA256 provider, GitHub digest) | `releases.openai.com`, `api.github.com`, `github.com` |

**Consequences for FR-001** (least privilege first, Q1):
1. Every official script is a **user-level** install with its own checksum check, so these come first on every OS (Copilot on Windows has no script, so winget, then npm).
2. **npm** on Windows (`%APPDATA%\npm`) is user-writable; on macOS and Linux it is only when the Node prefix is in the home folder (nvm, fnm, volta or `npm config prefix ~/.npm-global`). Otherwise npm is listed last with "needs administrator rights".
3. **winget and Homebrew** come after, labelled "may ask for administrator rights".
4. Durbar's own download must accept only the hosts in this table for the **first** request (the script); what the script downloads is the script's job, verified by its checksum. Durbar must not add `sudo` and must not run the script as root.
5. `~/.local/bin` is not always on a GUI app's `PATH`. Detection already looks there on macOS and Linux (A3), so the app is found right after install without a restart.

## Commands to run yourself (FR-009, read 2026-10-21)

Copied word for word from each vendor's install page; Durbar shows them with a Copy button and never runs them.

- GitHub Copilot CLI, `read:` https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli (2026-10-21): Windows `winget install GitHub.Copilot` (prerelease `GitHub.Copilot.Prerelease`); all OSes `npm install -g @github/copilot` (Node.js 22 or later); macOS and Linux `curl -fsSL https://gh.io/copilot-install | bash`, `brew install --cask copilot-cli`. No Windows script. Windows needs PowerShell 6 or later.
- Claude Code, `read:` https://code.claude.com/docs/en/setup (2026-10-21): Windows PowerShell `irm https://claude.ai/install.ps1 | iex` (recommended, no administrator); CMD `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd` (not listed: Durbar's labels are PowerShell); WinGet `winget install Anthropic.ClaudeCode` (no auto-update; `winget upgrade Anthropic.ClaudeCode`); macOS/Linux `curl -fsSL https://claude.ai/install.sh | bash`, `brew install --cask claude-code`; npm `npm install -g @anthropic-ai/claude-code` (Node.js 22 or later). The page no longer calls npm deprecated (npm is under *Advanced installation options*; the native install is "Recommended"), so Durbar's note now says that instead (spec *Changes* 2026-10-21).
- OpenAI Codex, `read:` https://github.com/openai/codex README and https://learn.chatgpt.com/docs/codex/cli.md (2026-10-21): Windows `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"`; macOS/Linux `curl -fsSL https://chatgpt.com/codex/install.sh | sh`; `npm install -g @openai/codex`; `brew install --cask codex`. **No winget** on OpenAI's pages (an `OpenAI.Codex` id appears only on a third-party listing, wingetly.io; not used). The current pages say nothing about WSL.
- App Execution Aliases (FR-010), `read:` https://github.com/npm/node-which/issues/157 (2026-10-21): `fs.statSync` throws EACCES on a WindowsApps alias that runs fine from a terminal; `fs.accessSync` and `lstat` work. winget is such an alias (`%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe`). Not checked on a Windows PC.


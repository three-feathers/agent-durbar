# Research: agent-app updates (spec 081)

Read on 2026-10-23 by Vikram's agent (spec writer). **Reads only**: official docs, vendor source on GitHub, and public read-only APIs (the npm registry, the GitHub releases API, formulae.brew.sh). No installer, updater, package manager or agent CLI was run for this research. Each item says where it comes from; *unconfirmed* means no official source said it.

Snapshot of "latest" on 2026-10-23 (`read:` the APIs named):

| App | npm `latest` (registry.npmjs.org) | GitHub release | Homebrew cask (formulae.brew.sh) | Vendor channel |
|---|---|---|---|---|
| Codex | 0.164.0 | `rust-v0.164.0` | `codex` 0.164.0 | n/a |
| Claude Code | 2.1.309 (`stable` 2.1.308, `next` 2.1.310) | n/a | `claude-code` 2.1.308 (stable channel) | `downloads.claude.ai/claude-code-releases/latest` 2.1.309, `/stable` 2.1.308 |
| GitHub Copilot CLI | 1.0.103 (`prerelease` 1.0.104-1) | `v1.0.103` | `copilot-cli` 1.0.103 | n/a |

The owner's Codex 0.163.0 (Homebrew cask) was one version behind on that day.

## R1 Install sources per app

- **Codex** (`read:` github.com/openai/codex README; learn.chatgpt.com/docs/codex/cli; registry.npmjs.org/@openai/codex; formulae.brew.sh/api/cask/codex.json; winget-pkgs `manifests/o/OpenAI/Codex`):
  - npm `@openai/codex` (`bin/codex.js` plus per-platform optional packages such as `@openai/codex-linux-x64`);
  - Homebrew cask `codex` (links `bin/codex` into `$HOMEBREW_PREFIX/bin`; `auto_updates` unset);
  - the standalone installer `https://chatgpt.com/codex/install.sh` / `install.ps1`, downloading from `releases.openai.com/codex` with a fallback to GitHub Releases. The docs say: re-run the same command to update. Install folder `<CODEX_HOME>/packages/standalone/releases/<ver>-<target>` (default `~/.codex`; from the source comments in `codex-rs/install-context/src/lib.rs`, not the docs). Spec 060 recorded the Windows script's `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` (`real:` 2026-10-20);
  - winget `OpenAI.Codex` exists (a portable zip of the GitHub release); whether it is kept current is *unconfirmed*. Durbar has no winget route for Codex today.
- **Claude Code** (`read:` code.claude.com/docs/en/setup):
  - native installer (recommended), `~/.local/bin/claude` → `~/.local/share/claude/versions/<ver>` (Windows `%USERPROFILE%\.local\bin\claude.exe`); it keeps the current and two newest versions;
  - Homebrew casks `claude-code` (stable channel, "about a week behind") and `claude-code@latest`;
  - winget `Anthropic.ClaudeCode`;
  - npm `@anthropic-ai/claude-code` (Node 22+; installs the same native binary through optional packages);
  - Linux apt, dnf and apk repositories at `downloads.claude.ai/claude-code/{apt,rpm,apk}/{stable,latest}`, package `claude-code`. Durbar has no route for these (they need `sudo`).
- **GitHub Copilot CLI** (`read:` docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli; github.com/github/copilot-cli; formulae.brew.sh/api/cask/copilot-cli.json):
  - npm `@github/copilot` (Node 22+);
  - Homebrew cask `copilot-cli` (and `copilot-cli@prerelease`), **`auto_updates: true`**;
  - winget `GitHub.Copilot` (and `GitHub.Copilot.Prerelease`);
  - the install script `https://gh.io/copilot-install` (default `~/.local` as a user, `/usr/local` as root);
  - release assets incl. `.msi` on Windows.
  - The old `gh copilot` extension is retired (docs: "Replacing the retired Copilot extension"; github.blog changelog 2025-09-25).
- **Copilot SDK runtime** (`read:` github/copilot-sdk `nodejs/README.md`): `@github/copilot-sdk` ships the runtime in `@github/copilot-sdk-<platform>`, downloads nothing at start, and does not depend on `@github/copilot`. `COPILOT_CLI_PATH` would point it at a user CLI; Durbar does not use that (constitution II: pinned runtime).

## R2 Homebrew

- `brew info --cask --json=v2 <cask>` gives `version`; `brew outdated --cask --json=v2 <cask>` lists it only when outdated. A cask with `auto_updates: true` (`copilot-cli`) is left out of `brew outdated` and `brew upgrade` unless `--greedy` (Homebrew's documented cask behaviour; *the exact flag behaviour should be re-read in `brew outdated --help` on a real Mac*).
- What Homebrew offers is its local copy of the API data (formulae.brew.sh), which Homebrew refreshes on its own schedule; `brew upgrade` refreshes before it runs unless `HOMEBREW_NO_AUTO_UPDATE` is set. Codex's own code says the cask can lag behind GitHub (`codex-rs/tui/src/updates.rs`).
- The Claude `claude-code` cask follows the **stable** channel, so a Homebrew Claude is "up to date" while npm already has a newer `latest`. Durbar must compare against the cask, not npm.

## R3 The apps' own updaters

- **Claude Code** (`read:` code.claude.com/docs/en/setup): native installs update themselves in the background; `claude update` applies an update now; for Homebrew, WinGet or apk installs it prints "Claude is up to date!" and does not update them. `DISABLE_AUTOUPDATER=1` stops only the background check (`claude update` still works); `DISABLE_UPDATES` blocks every update path, manual ones too; `autoUpdatesChannel` (`latest`/`stable`), `minimumVersion`; managed `requiredMinimumVersion`/`requiredMaximumVersion` stop Claude Code from starting outside the range. `claude doctor` reports the install and the auto-update state. The docs warn: no `sudo npm install -g`, and no `npm update -g`.
- **Codex, `codex update` is curl-to-shell** (`read:` openai/codex @970111f6 `codex-rs/tui/src/update_action.rs`, found by Paco's agent in the review of #663). For a standalone install it runs `sh -c "curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh"`, and on Windows `powershell -ExecutionPolicy Bypass -c "$env:CODEX_NON_INTERACTIVE=1; irm https://chatgpt.com/codex/install.ps1 | iex"`, with `sh`, `curl` and `powershell` from `PATH` (Codex does not set a system `PATH`: on Windows it keeps the inherited `PATH`'s absolute entries, `cli/src/main.rs:835-884`, so spec 081 has Durbar set a fixed system `PATH` for the child). For an install method it cannot detect, it exits with "Could not detect the Codex installation method". Codex counts a copy as standalone only under `<CODEX_HOME>/packages/standalone/releases` on every OS (`install-context/src/lib.rs:309-326`), and the `CODEX_MANAGED_BY_{NPM,PNPM,BUN,VITE_PLUS}` variables take priority over that path check (review on #663). Spec 081 uses `codex update` only for the official standalone copy, with those variables removed, a fixed `PATH` and the command shown (FR-009; owner decision Q3 = C, limited, 2026-10-25). It is **undocumented**.
- **Codex**: the docs say to re-run the installer to update. The source has a `codex update` subcommand (`codex-rs/cli/src/main.rs`) and an update banner: at most every 20 h, behind the config key `check_for_update_on_startup`, cached in `<CODEX_HOME>/version.json`; it looks up GitHub `releases/latest` (and npm for npm installs, formulae.brew.sh for brew) and suggests `npm install -g @openai/codex`, `brew upgrade --cask codex`, or `curl -fsSL https://chatgpt.com/codex/install.sh | CODEX_NON_INTERACTIVE=1 sh` (Windows: `$env:CODEX_NON_INTERACTIVE=1; irm …install.ps1 | iex`) (`codex-rs/tui/src/update_action.rs`). `codex update` is **not documented** (*unconfirmed* as a supported command).
- **GitHub Copilot CLI** (`read:` docs.github.com `cli-command-reference`; the copilot-cli changelog): `copilot update` downloads and installs the latest (channel arguments `stable`/`prerelease`); `copilot version` "displays version information **and checks for updates**" (so it contacts GitHub: Durbar must not use it as a plain version probe); an auto-updater keeps packages under `~/.copilot/pkg`; `--no-auto-update` exists. Whether `copilot --version` works offline is *unconfirmed*.

## R4 winget

`winget list --id <id> -e --upgrade-available` and `winget show --id <id> -e` are winget's own commands (Microsoft Learn winget docs); the output is a text table, not JSON, and its column names follow the system language, so a parser must read the version by column position and accept "No installed package found". *Not checked against a real Windows output yet*; fixtures must come from a recorded run. Windows locks a running `.exe`: Claude Code's docs say a WinGet self-upgrade "may fail because Windows locks the running exe".

## R5 Telling the install source from the real path

Durbar's `routeOwning` (`src/shared/harnesssetup.ts`) already covers `node_modules` and npm `.cmd` shims, `Cellar`/`Caskroom`/`/opt/homebrew/`/linuxbrew, `WinGet/Packages|Links`, `~/.local/bin|share`, `~/.claude/local`, `Programs/OpenAI/Codex`. Missing or worth refining:

- Codex's standalone folder `<CODEX_HOME>/packages/standalone/releases/` (→ official).
- Claude's `~/.local/share/claude/versions/` is covered by `~/.local/share`; the Copilot script's `~/.local/bin/copilot` is covered by `~/.local/bin`, but an auto-updated Copilot runs from `~/.copilot/pkg` (→ official).
- `/usr/local/bin` on an Intel Mac is not always Homebrew (Codex's own check has the same weakness): resolve the symlink first; only a real path under `Caskroom`/`Cellar` counts as Homebrew.
- Linux packages (`/usr/bin/claude` from apt/dnf/apk, `/snap/`) → outside Durbar's routes.
- Scoop `~/scoop/apps/<name>/current` → named, no route (*unconfirmed* per vendor; standard Scoop layout).
- The Homebrew cask name is part of the source: `claude-code` vs `claude-code@latest` (`Caskroom/<name>/`).
- Codex itself also honours `CODEX_MANAGED_BY_NPM` / `_BUN` / `_PNPM` (install-context source); bun and pnpm global installs have no Durbar route.

## R6 Updater per source (what spec 081 FR-009 runs; fixed argv, no shell)

| App | npm | Homebrew | winget | Official / native |
|---|---|---|---|---|
| Codex | `npm install -g @openai/codex@<checked>` | `brew upgrade --cask codex` | (no route today) | `codex update` (undocumented) for the official standalone copy only; otherwise, and as the fallback, the installer through spec 060's checked download with `CODEX_NON_INTERACTIVE=1` (R3; Q3 = C, limited) |
| Claude Code | `npm install -g @anthropic-ai/claude-code@<checked>` | `brew upgrade --cask claude-code` (or `claude-code@latest`) | `winget upgrade --id Anthropic.ClaudeCode -e --source winget` | `claude update` (documented; Q3) |
| Copilot CLI | `npm install -g @github/copilot@<checked>` | `brew upgrade --cask --greedy copilot-cli` (auto-updating cask) | `winget upgrade --id GitHub.Copilot -e --source winget` | `copilot update` (documented; Q3) |

The first three columns are the rows already in `ROUTES`. New are: pinning to the checked version for npm and winget (`--version <checked>`), `--greedy`, the `@latest` cask, and the own updaters. winget's agreement flags come only after the user has seen the terms (spec 081 FR-004).

## R7 What a check contacts (privacy)

- npm: the registry in the user's npm configuration (default `registry.npmjs.org`).
- Homebrew: `formulae.brew.sh` (API data), GitHub for a `brew update`.
- winget: the winget source CDN (*the exact host is not documented in the pages read*).
- Claude Code native: `downloads.claude.ai` (code.claude.com/docs/en/network-config lists it for "update version checks"); `storage.googleapis.com` only before 2.1.116.
- Codex standalone: `chatgpt.com`, `releases.openai.com`, `api.github.com`/`github.com`.
- Copilot: the GitHub release API (`copilot update` and `copilot version` authenticate those calls, changelog), so a Copilot check sends the user's GitHub sign-in to GitHub; spec 081 uses the npm, Homebrew or winget source for the "latest" of a Copilot CLI that one of those installed, and, for a script install, the `Location` header of `github.com/github/copilot-cli/releases/latest` without credentials (R8; the API's JSON is too big).
- `downloads.claude.ai/claude-code-releases/latest` and `/stable` answer plain text but are **not documented** as an API; the documented items are `…/<ver>/manifest.json` (signed since 2.1.89). Using them is a choice for the plan.

None of these is Durbar's own server, and none receives anything from Durbar beyond what the tool itself sends.

## R8 Reading "latest" without a body (added 2026-10-24, review of #663)

- `api.github.com/repos/openai/codex/releases/latest` is about **570 KB** (measured by Paco's agent, 2026-10-24), because of the release notes and asset list. That is far over a 64 KiB cap.
- `https://github.com/<owner>/<repo>/releases/latest` answers with a redirect to the tag. `real:` 2026-10-24, HEAD requests:
  - `302`, `location: https://github.com/openai/codex/releases/tag/rust-v0.164.0`;
  - `location: https://github.com/github/copilot-cli/releases/tag/v1.0.103`.

  Reading only the `Location` header gives the version with no body.
- `https://downloads.claude.ai/claude-code-releases/stable` and `/latest` answered `2.1.308` and `2.1.309` as plain text (`real:` 2026-10-24).
- Claude Code's channel is chosen by `autoUpdatesChannel` (`latest` or `stable`), and `minimumVersion` sets a floor for `claude update` (`read:` code.claude.com/docs/en/setup). Durbar does not read Claude's settings files, so it cannot know the channel (spec 081 Q7).
- Integrity (`read:` code.claude.com/docs/en/setup, *Binary integrity and code signing*): each Claude Code release publishes a GPG-signed `manifest.json` with SHA256 checksums. The docs describe checking it by hand and do not say that `claude update` checks it.

# Feature Specification: Harness setup inside the app

**Feature Branch**: `051-harness-setup`
**Created**: 2026-10-19
**Status**: Built (Phase 1): Settings > Harnesses with install, update and sign-in for Copilot, Claude Code and Codex; simulator and unit tests, plus real sign-in flows started and cancelled on this machine
**Input**: Issue #299. Owner (Telegram, 2026-10-19): "for harness setup itself - today we only say that in text, it is better to have wizards inside app to setup harnesses to make life of users easier as this app will also be used by non technical users". The open questions on #299 were decided by Vikram's agent under the owner's delegation the same day ("take decisions on issues which can be taken and you have all means to research and verify"); the decisions are in the issue comment and below.

## Summary

Today Durbar detects each harness (Copilot, Claude Code, Codex) as *ready*, *not installed*, *too old* or *not signed in* (spec 012 FR-033..FR-041, FR-132, FR-137) and tells the user, in text, to open a terminal and run a command. Someone who has never used a terminal stops there.

**Settings > Harnesses** shows one card per harness with its state and **one next step**: *Install…*, *Update…*, *Sign in…* or *Check again*. Durbar runs the vendor's own installer or sign-in, shows the link and the one-time code the vendor prints, and checks the harness again when it ends. Durbar never sees a password and never stores a token.

## Research (2026-10-19, this machine: Linux; Claude Code 2.1.303, Codex 0.163.0, Copilot CLI 1.0.98, gh 2.100.0)

Each sign-in was started **without a terminal** (stdin closed, output to a file), with an empty, throw-away config folder (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`) so no real login was touched, and stopped before it finished:

| Harness | Command | What it prints (no terminal) |
|---|---|---|
| Codex | `codex login --device-auth` | "Open this link … `https://auth.openai.com/codex/device`", then "Enter this one-time code (expires in 15 minutes)" and a code like `ABCD-EFGHI`, in ANSI colours; then it waits. |
| Copilot | `copilot login --device-code` | "To authenticate, visit `https://github.com/login/device` and enter code `ABCD-1234`", "Waiting for authorization..." |
| Claude Code | `claude auth login` | "Opening browser to sign in…", "If the browser didn't open, visit: `https://claude.com/cai/oauth/authorize?…`", then "Paste code here if prompted >": after signing in, the page shows a code to paste back. |

- **Copilot in Durbar does not use the Copilot CLI.** The runtime bundled with `@github/copilot-sdk` has no login command (`copilot-runtime login` → "unsupported argument"). It uses a sign-in already stored on the computer: a `copilot login`, or a **GitHub CLI** (`gh`) login (`getAuthStatus()` reported `authType: "gh-cli"` here). Passing a token to the SDK would mean Durbar holds it (constitution III), so the Copilot sign-in goes through the official Copilot CLI.
- `CopilotClient.getAuthStatus()` starts the runtime and answers in about 1 s; no prompt, nothing billed.
- **Install routes**, from the vendors' docs (read 2026-10-19; not all tried, see `[KNOWN GAP]`):
  - Claude Code: native installer script (recommended by Anthropic), `brew install --cask claude-code`, `winget install Anthropic.ClaudeCode`; npm `@anthropic-ai/claude-code` is deprecated.
  - Copilot CLI: `npm install -g @github/copilot` (Node 22+), `brew install copilot-cli`, `winget install GitHub.Copilot`, an install script.
  - Codex: `npm install -g @openai/codex`, `brew install --cask codex`; Windows support is experimental.

## Decisions (issue #299)

- **D1. Durbar may run an install itself, through a package manager only.** It installs only with a package manager it finds on PATH (winget, Homebrew, npm), with fixed arguments and no shell, after showing the exact command and asking. It **never pipes a downloaded script into a shell** (`curl … | bash`, `irm … | iex`): with no usable package manager it opens the vendor's install page instead.
- **D2. Sign-in runs the vendor's own flow** and Durbar shows its link and code. Device code for Codex and Copilot; for Claude Code, the link plus a box for the code the page shows, written to that process's input. The code is one-time and is never logged or kept.
- **D3. Where:** Settings > Harnesses, linked from the welcome screen and from an unready harness in the New session dialog. No forced first-run wizard; the demo stays one click away.
- **D4. The ready check is free:** detection and sign-in status only, never a paid test prompt.

## Requirements

- **FR-001** **Settings > Harnesses.** One card per registered harness, in registry order:
  - the name, a state chip (*Ready*, *Not installed*, *Update needed*, *Not signed in*, *Unknown*), the version when known, and the detection hint in plain words;
  - **one primary button** for the next step: *Install…* (not installed), *Update…* (too old), *Sign in…* (not signed in), none when ready;
  - always a quiet *Check again*, which re-runs detection (`adapters:list` with refresh) and, for Copilot, the sign-in status (FR-007).
  - Experimental harnesses are listed only when their flag is on (as in the picker).
- **FR-002** **Install plans** (`src/shared/harnesssetup.ts`, pure). For each harness and OS, the ordered routes (only those whose package manager is found on PATH are offered; the first is preselected):

  | Harness | Windows | macOS | Linux |
  |---|---|---|---|
  | Claude Code | `winget install --id Anthropic.ClaudeCode -e`, npm | `brew install --cask claude-code`, npm | `brew install --cask claude-code` (Linuxbrew), npm |
  | Copilot CLI | `winget install --id GitHub.Copilot -e`, npm | `brew install copilot-cli`, npm | `brew install copilot-cli`, npm |
  | Codex | npm (Codex on Windows is experimental) | `brew install --cask codex`, npm | npm |

  npm is `npm install -g <package>` (`@anthropic-ai/claude-code`, `@github/copilot`, `@openai/codex`). The Claude npm route is labelled "deprecated by Anthropic, use only if nothing else works". winget runs with `--accept-source-agreements --accept-package-agreements` only after the user has seen the agreement note in the dialog. **Update** uses the same manager: `winget upgrade …`, `brew upgrade [--cask] …`, `npm install -g <package>@latest`.
- **FR-003** **No usable route:** the dialog explains that no package manager was found and opens the vendor's official install page (a fixed https URL per harness) on click. It never runs a downloaded script.
- **FR-004** **Running an install or update** (`src/main/harnesssetup.ts`):
  - the exact command line is shown before it runs, and the user confirms;
  - argv only, no shell; a Windows `.cmd` (npm) goes through `windowsCmd` with `/d /s /c` and is refused when its path has a `cmd.exe` metacharacter (as detection does);
  - the dialog shows *Installing…*, the elapsed time and the **last 6 lines** of output (ANSI removed, through `redact()`), with *Cancel* (kills the process tree);
  - a 15-minute limit; one setup operation at a time;
  - on exit 0, detection runs again and the card updates; otherwise the dialog shows the exit code and the last lines, and suggests the official page.
  - Package managers may ask for admin rights (winget UAC, brew `sudo` for some casks): the dialog says so up front. Durbar never asks for a password itself.
- **FR-005** **Sign-in** runs the harness's own command (argv, no shell, the found binary):
  - Codex `login --device-auth`; Copilot CLI `login --device-code`; Claude Code `auth login`.
  - Durbar reads the output as it comes (ANSI removed) and shows:
    - **the link**, as a button that opens it in the browser. Only `https` links on that harness's own sign-in hosts are shown or opened (Codex `auth.openai.com`; Copilot `github.com`; Claude `claude.com`, `claude.ai`, `console.anthropic.com`, `platform.claude.com`); any other link is ignored;
    - **the one-time code** (Codex, Copilot), large, with *Copy*;
    - for Claude Code, a text box "Paste the code from the sign-in page" and *Continue*, which writes the code and a newline to the process's input. The box takes at most 512 printable characters with no line breaks.
  - The dialog waits; *Cancel* stops the process. A 16-minute limit (Codex codes expire after 15).
  - On exit, detection runs again. Signed in → the card turns *Ready* and the dialog says so; otherwise it shows the last lines.
  - The code, the pasted text and the output are never logged, written to disk or sent anywhere but that process.
- **FR-006** **Copilot needs the Copilot CLI only to sign in.** When Copilot is not signed in and the `copilot` CLI is not found, *Sign in…* first offers to install the Copilot CLI (FR-002), then continues with the sign-in.
- **FR-007** **Copilot sign-in status.** The Copilot adapter gets an optional `authStatus()` that calls `getAuthStatus()` on its shared runtime client: `{ signedIn: boolean }` only (the login name, host and message are dropped). Settings > Harnesses shows Copilot as *Not signed in* when it is false. Detection itself stays free of I/O (`detectCopilot`), so the app's start does not change.
- **FR-008** **Entry points:**
  - the welcome card leads with **Set up harnesses…**;
  - "About agent kinds" (the "?" next to the harness picker) has **Set up harnesses…**;
  - both open Settings at the Harnesses section.
- **FR-009** **Simulator:** with `DURBAR_SIM`, Settings > Harnesses shows Copilot *Ready*, Claude Code *Not signed in* and Codex *Not installed* (with `DURBAR_SIM_KINDS=mixed`). The install and sign-in dialogs play canned output (a fake link and code); nothing runs.
- **FR-010** **Safety summary** (constitution III):
  - no shell, fixed argv;
  - no downloaded scripts;
  - no tokens or passwords pass through Durbar; only a one-time code typed by the user is passed on, and only to Claude's own process;
  - links are allowlisted;
  - nothing is logged.

## Success criteria

- **SC-001** Someone with no terminal knowledge can go from *Not signed in* to *Ready* for Codex or Copilot by clicking *Sign in…*, opening the link and typing the code shown, without leaving Durbar except for the browser.
- **SC-002** Every command Durbar runs is shown to the user before it runs, and is one of the fixed plans in FR-002 or FR-005.
- **SC-003** `npm test` covers the plans per OS, the output parsing on the captured outputs, the link allowlist, the paste rules and the runner (fake processes).

## Evidence (2026-10-20)

- `[IMPLEMENTED]`:
  - `src/shared/harnesssetup.ts` (plans, sign-in parsing, link allowlist, paste rules);
  - `src/main/harnesssetup.ts` (`HarnessSetup` runner);
  - IPC `harness:*` and Copilot `authStatus()`;
  - `src/renderer/harnesses.js` (Settings > Harnesses cards and dialogs);
  - entry points: the welcome card's **Set up harnesses…**, and the same button in "About agent kinds";
  - simulator canned flows (`simkinds=solo`).
- `test:` `test:harnesssetup`:
  - plans per OS and copies, every argument a plain word;
  - sign-in parsing on the captured outputs, the link allowlist (suffix, prefix, user info, port and host per harness), the paste rules, ANSI handling and the last lines;
  - the runner with a fake process: argv, no stdin for device flows, one operation at a time, paste only to Claude, Copilot CLI missing, cancel, timeout, Linuxbrew found, Windows `.cmd` through `cmd /d /s /c` with an unsafe path refused, and output redacted.
- `sim:` `scripts/shots-051-setup.js` passes at 1440x900 and 1280x800:
  - three cards (Ready / Not installed / Update needed);
  - Install shows the exact commands, then runs and closes;
  - the sign-in shows the link button and the code.

  Screenshots: `docs/screenshots/051-*.png`. The welcome driver passes with the new step 1.
- `real:` 2026-10-20, this machine (Linux), through `HarnessSetup` with real processes. Each ran with an isolated, empty config folder (`CODEX_HOME`, `COPILOT_HOME`, `CLAUDE_CONFIG_DIR`) and was **cancelled before finishing**, so no real login was changed:
  - Codex: `auth.openai.com/codex/device` and a code;
  - Copilot CLI: `github.com` and a code;
  - Claude Code: a `claude.com` link and the paste prompt.

  All three ended "cancelled".
- `[KNOWN GAP]`:
  - no sign-in was completed through the app (that would replace the real logins on this machine);
  - no install ran for real: winget and Homebrew are not here, and npm `-g` was not run;
  - Copilot's signed-out state was not observed for real, because the runtime finds the GitHub CLI login in the keychain;
  - macOS and Windows are untested.

## Changes

- **2026-10-20 (spec 052 FR-045):** the cards say which plan each harness uses; the Claude and Codex sign-in and install hints point to Settings > Harnesses (the command stays in brackets); an install that worked goes straight to the sign-in when the harness needs one; the sign-in dialog names the account, adds a step 3 and no longer shows seconds; install choices lead with "Using Homebrew (recommended)" / "Using npm" above the command.

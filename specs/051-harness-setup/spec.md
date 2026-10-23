# Feature Specification: Harness setup inside the app

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Harness setup inside the app: Settings > Harnesses with install, update and sign-in (issue #299)
status: **built** (unit, simulator; real sign-in flows started and cancelled); the signed-in account per app (delta 2026-10-23: unit, simulator, real no-prompt check per app on Linux); D1 superseded by spec 060 FR-001 (the official installer comes first, downloaded and checked, never piped)
-->

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
  - Claude Code: native installer script (recommended by Anthropic), `brew install --cask claude-code`, `winget install Anthropic.ClaudeCode`; npm `@anthropic-ai/claude-code` was called deprecated by Anthropic until 2026-10-20; since 2026-10-21 the page lists it as an advanced option (spec 060).
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

  npm is `npm install -g <package>` (`@anthropic-ai/claude-code`, `@github/copilot`, `@openai/codex`). The Claude npm route was labelled "deprecated by Anthropic, use only if nothing else works" (since 2026-10-21, spec 060: "Needs Node.js 22 or later. Anthropic recommends its native installer."). winget runs with `--accept-source-agreements --accept-package-agreements` only after the user has seen the agreement note in the dialog. **Update** uses the same manager: `winget upgrade …`, `brew upgrade [--cask] …`, `npm install -g <package>@latest`.
- **FR-003** **No usable route:** the dialog explains that no package manager was found and opens the vendor's official install page (a fixed https URL per harness) on click. It never runs a downloaded script.
- **FR-004** **Running an install or update** (`src/main/harnesssetup.ts`):
  - the exact command line is shown before it runs, and the user confirms;
  - argv only, no shell; a Windows `.cmd` (npm) goes through `windowsCmd` with `/d /s /c` and is refused when its path has a `cmd.exe` metacharacter (as detection does);
  - the dialog shows *Installing…*, the elapsed time and the **last 6 lines** of output (ANSI removed, through `redact()`), with *Cancel* (kills the process tree);
  - a 15-minute limit; one setup operation at a time;
  - on exit 0, detection runs again and the card updates; otherwise the dialog shows the exit code and the last lines, and suggests the official page.
  - Package managers may ask for admin rights (winget UAC, brew `sudo` for some casks): the dialog says so up front. Durbar never asks for a password itself.
- **FR-004b** **Consent the page cannot fake** (security review, 2026-10-20) `[IMPLEMENTED]`:
  - the main process resolves the operation first (`prepare`: the binary's **real path**, symlinks resolved, and its fixed arguments), then asks in a **native dialog** (`dialog.showMessageBox`, Cancel is the default) showing that path and those arguments; only *Install*/*Update* there starts it (`start`). The page's own plan dialog stays as the place to choose; it is no longer the consent.
  - Sign-in is not confirmed natively: it runs the harness's own fixed login, changes nothing else, and is finished by the user in the browser.
  - every `harness:*` IPC call is answered only for the app's own page in the window's main frame (`senderAllowed`).
  - macOS/Linux: a binary that is world-writable, or sits in a world-writable folder (even a sticky one such as `/tmp`), is not run. `[KNOWN GAP]` Windows ACLs are not read.
  - winget installs and upgrades name `--source winget`. `taskkill` runs from `%SystemRoot%\System32`; no SIGKILL to a process group after its leader has exited.
  - `harness:openSignIn` opens the parsed, normalised URL (`new URL(url).href`) after the host check.
- **FR-004c** **Output handling** `[IMPLEMENTED]`: progress events at most about 4 a second (the last state always arrives); bytes are decoded as whole UTF-8 characters; in the plain lines the sign-in link and code (shown on their own) are replaced and OAuth values in URLs (`code`, `state`, `device_code`, tokens) are hidden; a child that fails to start ends the operation (once) and frees the runner.
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

- **2026-10-20 (spec 052 FR-072, FR-073):** Windows detection also searches `%LOCALAPPDATA%\Microsoft\WinGet\Links`, where winget puts its command shims (`test: test-detect`). After an install that worked, a re-check that still says Not installed shows "Installed? If Durbar still says Not installed, close and reopen Durbar, then choose Check again." [KNOWN GAP] PATH is not re-read from the registry after an install. The Copilot card on Windows hints at PowerShell 7 when `pwsh.exe` is not found (`HarnessSetup.pwshMissing`, text only). Not run on Windows.
- **2026-10-20 (spec 052 FR-056):** the cards add a muted "· for ChatGPT / Claude / GitHub" subtitle; the install dialog leads each way with "Durbar installs <App> for you with Homebrew (recommended)" and moves the exact commands into "Show the exact command" (closed in Simple, open in Expert). The native main-side confirmation (FR-004b) still shows the real program and arguments before anything runs. Not run in the simulator in this change (`read:`).
- **2026-10-20 (spec 052 FR-045):** the cards say which plan each harness uses; the Claude and Codex sign-in and install hints point to Settings > Harnesses (the command stays in brackets); an install that worked goes straight to the sign-in when the harness needs one; the sign-in dialog names the account, adds a step 3 and no longer shows seconds; install choices lead with "Using Homebrew (recommended)" / "Using npm" above the command.
- **2026-10-20 (security review, FR-004b/FR-004c):** a round-4 security reviewer found that consent lived only in the page. Installs and updates now need a native main-side confirmation with the real path; harness calls check the sender frame; world-writable binaries are refused on macOS/Linux; winget names its source; output lines hide the link, the code and OAuth values; progress is throttled. `test:` `scripts/test-harnesssetup.ts`. Not checked on Windows or macOS (`read:`); the native dialog was checked in the simulator only as far as the page goes (the simulator has its own canned runner).

### 2026-10-21: known gaps revalidated

- **"No install ran for real" and "macOS and Windows are untested"** are narrowed by CI. These runs used the app's own `HarnessSetup` code on GitHub's ubuntu, macOS and Windows runners, as a standard user and as admin (spec 060 T060, #393): every route Durbar offers there was installed for real, then detected and run with `--version`.
  - The official installers work without admin rights on all three.
  - npm and Homebrew fail for a standard user on macOS, as their notes say.
  - Codex's Windows installer needed two fixes found by those runs: Windows' own `tar` first on PATH, and detection of `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`.
  - Install-check runs 39485719890 and 39493963859; e2e run 39496442403 installs through the first route and then signs in.
- **Signed-out Copilot** is still not observed through the keyring path. Through a token (`COPILOT_GITHUB_TOKEN`), an account without Copilot gave a 403 on the model list in the e2e (spec 062 Changes), which Durbar reported as a failure at models, not at sign-in. `[KNOWN GAP]`: `verifySignIn` said `signed-in` for that account, because its quota call succeeded.
- **No sign-in completed through the app** is unchanged (it would replace the real logins on this machine). The e2e signs in with tokens and API keys instead, which is not the app's browser or device-code flow.
- **Windows ACLs are not read** is unchanged (world-writable checks are macOS and Linux only).

### 2026-10-21: D1 superseded by spec 060 FR-001 (official installers)

- **D1 delta.** D1 said a package manager only, never a downloaded script, and otherwise the vendor's page. Spec 060 FR-001 (owner Q1, least privilege first) supersedes it:
  - the vendor's official installer is downloaded **after** the native confirmation, from that vendor's fixed hosts only (checked on every redirect);
  - it is saved into a private temp folder, checked to look like a script (not a web page), and **run as a file, never piped**;
  - package managers come after it, or first when they own the installed copy (Update).
  - Details and tests: spec 060 `## Changes`.

### 2026-10-23: the signed-in account per agent app (owner request, issue #617)

**Input.** Owner (Vikram, 2026-10-23): "When we are logged into agent app, if it possible to show logged in username when available". This delta supersedes the part of FR-007 (and spec 012 FR-132's comment) that dropped the login name: the name may now reach the window, and only the window.

**Research (2026-10-23, this machine: Linux; Copilot SDK/runtime 1.0.22, Claude Code 2.1.304, codex-cli 0.163.0; no prompt, nothing billed).** Each probe printed only the field names and types, not the values:

| App | Call | What it reports | Evidence |
|---|---|---|---|
| Copilot | `CopilotClient.getAuthStatus()` on the started runtime (about 0.2 s) | `isAuthenticated`, `authType` (`user`, `env`, `gh-cli`, `hmac`, `api-key`, `token`), `host`, `login`, `statusMessage` | `read:` SDK `types.d.ts` `GetAuthStatusResponse`; `real:` a real account's login shown, `authType: "gh-cli"`, host `https://github.com` |
| Claude Code | `claude auth status --json` (local) | `loggedIn`, `authMethod` (`claude.ai`, `api_key`, `oauth_token`, `third_party`, `none`), `apiProvider` (`firstParty`, Bedrock, Vertex, ...), and for `claude.ai`: `email`, `orgId`, `orgName`, `subscriptionType` (`pro`, `max`, `team`, `enterprise`); for an API key: `apiKeySource` | `read:` the 2.1.304 bundle (the `cli_auth_status` code); `real:` a real account's email shown, `authMethod: "claude.ai"`, `subscriptionType: "max"` |
| Codex | app-server `account/read` with `refreshToken: false` (about 2 s with the app-server start) | `account`: `{type: 'chatgpt', email, planType}`, `{type: 'apiKey'}` or `{type: 'amazonBedrock'}`, or `null`; `requiresOpenaiAuth` | `read:` `codex app-server generate-json-schema` (`v2/GetAccountResponse.json`, `PlanType`: `free`, `go`, `plus`, `pro`, `team`, `business`, `enterprise`, `edu`, ...); `real:` a real account's email shown, `type: "chatgpt"`, `planType: "plus"` |

No token, auth file or keychain entry is read: only what the app itself reports. Copilot's `statusMessage` is not used (it can repeat the login).

- **FR-011** **The account, as the app reports it.** An optional adapter method `accountInfo()` answers `{ status: 'signed-in' | 'signed-out' | 'unknown', name?, service?, plan?, method? }` (`src/shared/account.ts`, no vendor types):
  - Copilot: `getAuthStatus()`: `name` = `login`; `service` = "GitHub", or the host name for another host (GitHub Enterprise); `method` from `authType` (`gh-cli` = "through the GitHub CLI", `env`/`token` = a token from the environment, `api-key`/`hmac` = a key).
  - Claude Code: `claude auth status --json` (the same call detection makes): `claude.ai` = `name` from `email`, `plan` "Claude Pro/Max/Team/Enterprise" from `subscriptionType`; `api_key` = "an Anthropic API key" (with the email only when the CLI gives one); `oauth_token` = "a long-lived token"; a third-party provider names it (Amazon Bedrock, Google Vertex AI); `loggedIn: false` = signed out.
  - Codex: `account/read` with `refreshToken: false` on a short-lived app-server: `chatgpt` = `name` from `email`, `plan` "ChatGPT Plus/Pro/..." from `planType`; `apiKey` = "an OpenAI API key"; `amazonBedrock` = "Amazon Bedrock"; `account: null` with `requiresOpenaiAuth` = signed out; an older Codex without the method = unknown.
  - A missing field, a wrong type, an error or a timeout gives fewer facts or `unknown`, never a guess. Names are cut to one line of at most 80 characters with control characters removed.
- **FR-012** **One line of text** (`accountLine`, pure): "Signed in as <name> (<service>)", "Signed in as <name> · <plan>", "Signed in with an OpenAI API key", "Signed in; the app does not say which account", "Not signed in", "Account unknown".
- **FR-013** **Where it shows:**
  - Settings > Agent apps: one line on each ready card (`.hs-acct`), under the plan line;
  - the agent-app picker (top bar defaults and the New session dialog): each option's tooltip, and the select's own tooltip for the chosen app;
  - "About agent apps": the line after each app's state.
  - Only on a ready card: a card that is not installed, too old or not signed in already says so with its chip. Not in the agent's chat header (optional in the request; left out to keep the header calm).
  - The lines fill in after Settings is painted (Codex's answer takes about 2 s), with "Checking the account…" until then. `[IMPLEMENTED]`
- **FR-014** **Asked once, refreshed when it matters.** Main keeps one answer per app for the run (`harness:accounts`), asked only for apps that are `ready` or `not-signed-in`, each with a 6 s limit; Settings asks again when it opens and on *Check again*, and a sign-in that ends (FR-005) clears that app's answer. Never under the simulator (spec 010 FR-030): the simulator's page answers a fake identity (`octo-sim`, `sim@example.com`), so screenshots never show a real account.
- **FR-015** **Personal data.** The name and email reach the window only, through `harness:accounts`. They are never written to the debug log (`DURBAR_LOG`), the activity log, exports, telemetry, remote control or chat-channel messages, the MCP agent-state server or `adapters:list` (whose hints stay free of account data, spec 012 FR-156). The adapters do not pass the answer to `debug`.
- **Tests.** `test:account`: each adapter's `accountInfo` with fake SDK, CLI and app-server answers (every form above, missing fields, wrong types, errors, a hostile name), `accountLine`, the main cache (once per run, refresh, cleared after a sign-in, ready apps only, timeout), and that a marker email never reaches the adapters' debug sink, `adapters:list` or the activity-log writer; a source check that only the allowed files call `accountInfo`. `sim:` `scripts/shots-051-account.js` at 1440x900 and 1280x800.
- `[IMPLEMENTED]` `src/shared/account.ts`, `src/adapters/accounts.ts`, each adapter's `accountInfo`, `src/main/accounts.ts`, IPC `harness:accounts`, `src/renderer/harnesses.js` (`.hs-acct`), the picker tooltips and "About agent apps" in `app.js`, the simulator's fake identities (`simacct=apikey|unknown`).
- `test:` `test:account` (mapper forms, missing fields, wrong types, hostile names, the three adapters on fakes, the cache, the log and list paths, a source check of the files on the account path); 14 hand mutations (logging the answer in an adapter or the IPC handler, a token refresh, the cache ignoring refresh or forget, wrong signed-out rules, the line dropping the plan, the bidi filter) were all caught.
- `sim:` `scripts/shots-051-account.js` passes at 1440x900 and 1280x800 (cards, picker tooltips, About agent apps, API key, unknown, not signed in); screenshots `docs/screenshots/051-account-*.png`, and `051-harnesses-*.png` retaken.
- `real:` 2026-10-23, this machine: one probe per installed app with no prompt (above) showed a real account's identity in each, then the same through Durbar's own built adapters (`accountInfo` of Copilot, Claude Code and Codex: signed in, with a name, and the plan for Claude and Codex). The values are not written anywhere. The line in the real app's window was not looked at (only in the simulator). `[KNOWN GAP]` Not run on macOS or Windows; Copilot through a `copilot login` (`authType: "user"`), an Enterprise host, Claude Code with an API key or a Team plan, and Codex with an API key were read from the docs and code only.

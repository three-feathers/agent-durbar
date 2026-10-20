<p align="center">
  <img src="build/icon.svg" alt="Agent Durbar icon: a lead and a working team" width="96" height="96">
</p>

<h1 align="center">Agent Durbar</h1>

<p align="center"><em>A calm command center for your AI agents</em></p>

Agent Durbar is an office-style desktop app to **see, chat with and coordinate AI agents across several agent apps (harnesses)**: GitHub Copilot, Claude Code and OpenAI Codex. It is for **anyone who works with agents**, not only developers. A room is any folder an agent works in: code, documents, research or notes.

**Website:** <https://three-feathers.github.io/agent-durbar/>

> **Status: alpha.**
> - The newest pre-release is [`v0.1.0-alpha.8`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.8). It is unsigned and not notarized.
> - What changed in each release is in the [CHANGELOG](CHANGELOG.md).
> - Only Linux has been run by hand. macOS and Windows builds are made and checked in CI but are untested on real machines.
> - Built by [Three Feathers](https://github.com/three-feathers), tracked on the [project board](https://github.com/orgs/three-feathers/projects/1).

![15 simulated agents at 1440x900](docs/screenshots/m5-sim15-1440x900-closed.png)

> **Disclaimer.** Agent Durbar is an independent community project. It is **not affiliated with, endorsed by or sponsored by GitHub, Microsoft, Anthropic or OpenAI**. "GitHub Copilot", "Visual Studio Code", "Claude" and "Codex" are trademarks of their owners. Durbar only drives the tools you installed yourself, on your own machine.

## Contents

- [What you can do](#what-you-can-do)
- [Harnesses](#harnesses)
- [Install](#install)
- [Safety model](#safety-model)
- [Costs and caps](#costs-and-caps)
- [Themes](#themes)
- [Build from source](#build-from-source)
- [Known limits](#known-limits)
- [Roadmap](#roadmap)
- [How we work](#how-we-work)
- [License and credits](#license-and-credits)

## What you can do

**The office**
- Every agent is a person at a desk in its folder's room. You see at a glance who is idle, working, thinking, waiting for you or in trouble.
- 10-15 agents stay readable on one 1440x900 or 1280x800 screen, and the desks get denser on their own.
- Sub-agents (helpers) sit next to the agent that started them.
- Agents show how they are doing: heavy, monster, ambulance, room sirens. Main agents walk to a **place** in a shared lobby for the tool they use.
- **Floors** group rooms and can be switched off. A **List** view is there when you want rows instead of desks.
- A room's **⋯** menu offers New session, Rename, Hide and **Remove folder**.

**Chat**
- Click an agent to open a full-screen chat. All the other agents stay in a slim strip.
- You see its thinking, tool calls and replies as they stream in, with Markdown and copy buttons.
- Attach files and images by picking, dropping or pasting.
- Questions an agent asks you appear as a card with its choices, an "Other" answer and Skip.
- **Needs you:** one inbox of every agent waiting for you, oldest first with how long each has waited. While Durbar is in the background the window title ("(3) Agent Durbar"), the app icon and one notification tell you (Settings > Notifications turns it off; it shows only the agent's name and a short summary). In a waiting chat, **Alt+A** allows once, **Alt+S** allows for the session, **Alt+D** denies and **Alt+N** goes to the next agent; **?** lists every shortcut.
- **Stop** a turn or **End** a session from the chat header or from the agent's card menu ([screenshot](docs/screenshots/005-card-menu-stop-end-1440x900.png)).

**Sessions and folders**
- One session per folder or `.code-workspace` file, or several per folder (**+ New session**).
- After a restart, each folder **continues its last session**.
- *Previous sessions* lists a folder's earlier sessions to **Resume**, and VS Code's Copilot Chat history as a read-only copy (it opens at the latest message, and **Continue in VS Code** opens the folder there; [screenshot](docs/screenshots/009-vschat-latest-1440x900.png)). With two or more entries, a **search box** filters them by title (case and accents ignored).
- **New session with a summary:** start fresh from a hand-off summary of the current conversation, which you edit before it is sent.
- **Scheduled prompts** per folder (once, every N minutes, or every day at a time), while the app is open. Open them from a room's **⋯** menu, the **clock** in its header (shown once it has schedules), the **Schedules** button in its chat, or **Settings > Schedules** for all folders. A **starter kit** has templates:
  - *Start my day* (a morning briefing from your mail and calendar MCP servers);
  - *Summarize my day*, *Plan my day*;
  - *Open pull requests and CI*, and a dependency check.

  The briefing and planning ones end by **asking you what to do next** with a question card, and the agent waits for you in the office.
- **Custom agents** per session: `.github/agents` or `~/.copilot/agents` for Copilot, `.claude/agents` for Claude.
- **Open in VS Code** opens the folder (VS Code, then Insiders, then VSCodium).

**Models, context and tools**
- Pick the model and reasoning effort per session, and switch them in a running session where the harness allows it.
- A context chip shows how full the window is, with **Compact**.
- **MCP servers:**
  - your Copilot CLI list (`~/.copilot/mcp-config.json`) is used first;
  - each folder can add extras (with a trust prompt), import them from `.vscode/mcp.json`, and switch a server on or off per session.
  - when a server asks you for input (a small form, or a sign-in page), the chat shows it with **Submit / Decline / Cancel**; a page opens in your browser only after you click, and only if it is https (simulator and test harnesses only so far, not yet tried with a real server).
- **Tools** shows what each agent used, for *This session* and *All time*, and a **Cost** tab with each folder's ≈ money, AIU, Claude estimate, tokens and calls (*This run* or *Since <date>*), with **Copy as CSV**. Clicking a room's cost opens it.

![Full-screen chat with the other agents in a slim strip, 1280x800](docs/screenshots/m6-fullchat-sim15-1280x800.png)

## Harnesses

Durbar offers each agent app (harness) that is **installed and signed in on your computer**. When two or more are ready, the toolbar and the New session dialog show an **Agent app** picker; with one, nothing extra is shown.

| Harness | What Durbar runs | Checked on a real account |
| --- | --- | --- |
| **GitHub Copilot** | The Copilot runtime bundled with the official `@github/copilot-sdk`, with your `copilot login`. | Yes, since milestone 1. Not seen yet: switching between two real models, the long-context tier, `confirmation_required`, and a real credit cap being reached. |
| **Claude Code** | Your installed `claude` over its stream protocol. Durbar loads none of Claude's settings files. | Yes (Claude Code 2.1.302-2.1.303): every mode, interrupt, stop, resume, the live mode switch, models, previous sessions, questions, MCP switches, sub-agents, custom agents, the context window, the cost cap, summaries, and the full app across a restart. |
| **OpenAI Codex** | Your installed `codex app-server`, with a ChatGPT sign-in or an API key. | Yes (Codex 0.163, Linux): every mode, interrupt, End session, resume, a mode switch, models, history, questions, MCP tools, sub-agents, summaries, and the full app across a restart. |

What each harness can do differs a little, and Durbar hides a control a harness cannot honour rather than faking it. Two Codex specifics:
- A mode change applies from the next message.
- **Stop** does not kill a command that is already running; *End session* does.

Details and evidence: [spec 012](specs/012-claude-codex-adapters/spec.md).

**Codex on Ubuntu 24.04 and later.** Codex's Read-only and Ask first modes run commands in its Linux sandbox (bubblewrap). Ubuntu blocks that for unprivileged programs, so those modes fail at start with a message saying so; Allow all needs no sandbox. To allow only bubblewrap, add an AppArmor profile (needs `sudo`):

```
# /etc/apparmor.d/bwrap, then: sudo apparmor_parser -r /etc/apparmor.d/bwrap
abi <abi/4.0>,
include <tunables/global>
profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
}
```

Codex also ships its own `bwrap` inside its npm package (`…/@openai/codex-linux-x64/vendor/…/codex-resources/bwrap`). Add a second profile with that path if `codex` still reports a sandbox error.

## Install

**Requirements**
- At least one agent app: GitHub Copilot (a free plan works), Claude Code, or OpenAI Codex. **Settings > Agent apps** can install it through a package manager (winget, Homebrew, npm), with the command shown first, and sign you in with the vendor's own page and a one-time code. Or install and sign in yourself, for example with `copilot login`.
  - Not tried yet: installs through winget or Homebrew, and the flows on macOS and Windows.
- Durbar never sees, stores or sends your tokens: each harness reads its own sign-in. Durbar has no accounts, no servers and no telemetry.
- Usage bills against **your** plans. Several agents in parallel can use credits quickly; see [Costs and caps](#costs-and-caps).
- Optional: VS Code, VS Code Insiders or VSCodium, for *Open in VS Code*.

**Download** the build for your system from the [Releases page](https://github.com/three-feathers/agent-durbar/releases). Check it against `SHA256SUMS.txt`. There is no auto-update: download a newer release to update.

| System | File |
| --- | --- |
| macOS, Apple Silicon | `Agent-Durbar-<version>-arm64.dmg` (or `.zip`) |
| macOS, Intel | `Agent-Durbar-<version>-x64.dmg` (or `.zip`) |
| Windows 10/11, x64 | `Agent-Durbar-Setup-<version>.exe` or `Agent-Durbar-<version>-portable.exe` |
| Linux, x64 | `Agent-Durbar-<version>-x86_64.AppImage` |

**The builds are not code-signed** (certificates cost money), so your OS warns you the first time. Only open files from this repository's Releases page.
- **macOS:** right-click the app and choose **Open**, or allow it in System Settings > Privacy & Security. If macOS says it is damaged, run `xattr -dr com.apple.quarantine "/Applications/Agent Durbar.app"`.
- **Windows:** on "Windows protected your PC", click **More info**, then **Run anyway**.
- **Linux:** run `chmod +x Agent-Durbar-*.AppImage && ./Agent-Durbar-*.AppImage`. Add `--no-sandbox` on systems without unprivileged user namespaces.

## Safety model

Agents run **locally, on your machine, as you**, in the folders you add. Every agent has a permission mode. The names are the same for every harness, and Durbar maps them to each tool's own controls.

- **Read-only** (the default): reads inside the session's folders only; everything else is denied.
- **Ask first**: writes, shell commands, URLs and tools wait for *Allow once*, *Allow “…” for this session* or *Deny* (the same words in Simple and Expert).
- **Allow all**: no prompts. Use it only in folders you trust; it asks once to confirm.

Change the mode any time from the chat header chip or the agent's card menu.

Rules that always apply:
- **Add project folders, not your home folder or a drive root.** Everything under an added folder counts as the agent's own; Durbar warns calmly when you add one of those.
- **Answering a question** an agent asks is allowed in every mode; it is not an action.
- **A profile (custom agent) from a folder's repository** asks once before it is used and never changes your mode.
- **Durbar never stores or logs** tokens, session content or your prompts. Debug logs are redacted.

Codex in Read-only and Ask first gets an OS-enforced permission profile limited to the session's folders, and Durbar refuses those modes when the profile cannot be enforced. Claude Code gets its permission mode, allowed read tools and a check that reads stay inside your folders. Details: [spec 003](specs/003-permissions-and-approvals/spec.md) and [spec 012](specs/012-claude-codex-adapters/spec.md). To report a security problem, see [SECURITY.md](SECURITY.md).

![Warning after adding the home folder, 1440x900](docs/screenshots/006-home-warning-1440x900.png)

## Costs and caps

- **Copilot** reports usage in AI credits (shown as AIU). A session can have a **spending limit**, at least 30 AI credits:
  - set it in the New session dialog or the limit chip;
  - a global default is in Settings;
  - it is saved per folder.

  It is a soft limit: when it is reached (*Spending limit reached*), the chat offers *Add credits / Remove limit / Stop here*. The office and each room show usage totals, kept across restarts, with a reset in Settings.
- **Claude Code** reports a dollar *estimate*, shown as `≈ $… est.` and never mixed with AIU. A session can have a **spending limit in dollars** (at least $0.01):
  - Durbar passes what is left to Claude's own `--max-budget-usd`;
  - when the limit is reached, the chat offers *Raise limit / Remove limit / Stop here*;
  - the limit is per session.

  With a Claude subscription, nothing is billed per token.
- **Codex** reports tokens, with no price.

## Themes

**Settings > Theme** changes the whole app live, without a restart: colours, room frames, cards, fonts, place names, and the people and furniture in the office.
- **Clean Office:** the default, and the fallback for anything unknown or broken.
- **Corporate:** a navy bar, white rooms with an accent edge, square corners.
- **Retro Pixel:** a dark arcade page with pixel characters at CRT desks.
- **Durbar · Indian / European / Japanese:** three royal courts, each with its own frames, colours and court place names.
- **Make a theme with AI:** describe a look ("a pirate ship at night"), or pick one of the ideas, and Claude Code or Codex designs a light or dark theme: colours, a style, place names and art for the people and furniture. Durbar keeps only safe values, cleans the art like an imported pack, and checks that text stays readable; the AI gets up to 3 passes to fix what fails. Try it on the whole app before you save it. One theme costs about a cent on Claude (haiku).
- **Your own themes:** a folder with a `manifest.json` (colours, a UI style and a scene kit from fixed lists, small SVG art, place names), imported and exported in Settings. A theme is data only: no scripts and no CSS, SVG art is rebuilt from allowed shapes, and a pack that breaks a rule is refused with a message.

Status, permission and credit wording, and the layout, are the same in every theme. Display fonts are your system's own serif and monospace fonts. Details: specs [035](specs/035-theme-foundation/spec.md)-[040](specs/040-user-themes/spec.md).

| Corporate | Retro Pixel | Durbar · Indian |
| --- | --- | --- |
| ![Corporate theme](docs/screenshots/035-corporate-1440x900.png) | ![Retro Pixel theme](docs/screenshots/035-retro-1440x900.png) | ![Durbar Indian theme](docs/screenshots/035-durbar-indian-1440x900.png) |

## Build from source

```bash
npm ci
npm run typecheck && npm run build && npm test   # unit suites in parallel (~20 s); `npm test -- folders` filters
npm start                 # the app, with the harnesses you have installed and signed in
DURBAR_SIM=15 npm start   # 15 simulated agents: no sessions, no AI credits
npm run check:office      # layout check at 1440x900 and 1280x800 (Electron; xvfb on Linux), simulator only
npm run check:geometry    # every theme lays out exactly like Clean Office (about a minute)
npm run check:themes      # on demand: the full layout check in every theme, a few at a time, low priority, memory limits
npm run pack:dir          # unpacked app for this OS in release/ (also dist, dist:mac:arm64, dist:mac:x64, dist:win, dist:linux; unsigned)
```

`npm run smoke` and `npm run verify:cap` use a real Copilot login and may spend credits: run them only on purpose. Releases are built by GitHub Actions from `v*` tags into a draft release that the maintainer publishes by hand.

**Layout of the repository:**
- `src/main` (Electron main), `src/preload`, `src/renderer` (plain HTML/CSS/JS, the simulator);
- `src/adapters` (Copilot, Claude Code and Codex adapters, the permission broker), `src/shared`;
- `scripts/` (tests and screenshot drivers), `specs/` (Spec Kit specs), `docs/`.

## Known limits

- **Only Linux has been run by hand.** macOS and Windows packages are built, and a packaged-app check runs on all three in CI, but nobody has used them on real machines yet.
- **Unsigned builds:** expect the OS warnings above.
- **VS Code's own chats are read-only.** VS Code keeps them in an undocumented store that cannot be continued from outside; Durbar shows a copy. Copilot CLI/SDK sessions *can* be resumed.
- **Caps are soft:** one model response can overshoot them, and the figures are what each harness reports.
- **Floors that are off are quiet:** their agents keep running and can spend credits or wait for an approval.
- **Imported MCP config:** importing from `.vscode/mcp.json` is a one-time copy per folder.
- **Moving targets:** harness protocols change, so versions are pinned and checked.

## Roadmap

- **Done:**
  - the office, chat, permissions, attachments, MCP, tools, usage and caps, themes, floors, places, moods and scheduled prompts;
  - Copilot, Claude Code and Codex side by side, with session resume and continuation;
  - model and context switching, and new session with a summary.
- **Next:**
  - real-account checks of Copilot model switching and the long-context tier (with a paid plan);
  - macOS and Windows on real machines;
  - the Durbar MCP server, to read the office from your own MCP client ([spec 041](specs/041-durbar-mcp/spec.md), in progress).
- **Ideas being specified:** a global assistant chat across sessions, multiple profiles (personal/work accounts), and a morning briefing. See the [issues](https://github.com/three-feathers/agent-durbar/issues).
- **Needs a purchase:** code signing and notarization ([spec 014](specs/014-signing-and-notarization/spec.md)).

What was built when, and how it was checked, is in the [feature history](docs/feature-history.md) and the [CHANGELOG](CHANGELOG.md).

## How we work

Agent Durbar is spec-driven with [GitHub Spec Kit](https://github.com/github/spec-kit): **no code without a spec, a plan and tasks.**
- Every feature has a folder in [`specs/`](specs/README.md). Each requirement is tagged `[IMPLEMENTED]` or `[KNOWN GAP]`, with how it was checked.
- The rules are in the [constitution](.specify/memory/constitution.md).
- A CI check fails a pull request that changes `src/` without changing `specs/`.
- Coding agents follow [AGENTS.md](AGENTS.md). People start with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/collaboration.md](docs/collaboration.md).
- Claim an issue on the [project board](https://github.com/orgs/three-feathers/projects/1) before you start.

## License and credits

[MIT](LICENSE), Copyright (c) 2026 Three Feathers contributors.

Agent Durbar is by **Three Feathers**. Key contributors: [vikramgorla](https://github.com/vikramgorla), [fjcabello](https://github.com/fjcabello) and [rubenlupi](https://github.com/rubenlupi) (GitHub handles are used as the names). The names live in [`src/shared/about.ts`](src/shared/about.ts) and are shown in the OS About panel and in Settings > About.

The app id is `io.github.three-feathers.agentdurbar` since 2026-10-16. A build from before then is a separate app to the OS; uninstall it by hand. Saved data is kept.

Repository: <https://github.com/three-feathers/agent-durbar>. See also [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

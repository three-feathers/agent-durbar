<p align="center">
  <img src="build/icon.svg" alt="Agent Durbar icon: a lead and a working team" width="96" height="96">
</p>

<h1 align="center">Agent Durbar</h1>

<p align="center"><em>A calm command center for your AI agents</em></p>

Agent Durbar is an office-style desktop app to **see, chat with and coordinate AI agents across several agent apps (harnesses)**: GitHub Copilot, Claude Code and OpenAI Codex. It is for **anyone who works with agents**, not only developers. A room is any folder an agent works in: code, documents, research or notes.

**Website:** <https://three-feathers.github.io/agent-durbar/>

> **Status: first stable release.**
> - The newest release is [`v0.1.5`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.5) (2026-11-01), after [`v0.1.4`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.4) (2026-10-31), [`v0.1.3`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.3) (2026-10-30), [`v0.1.2`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.2) (2026-10-29), [`v0.1.1`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.1) (2026-10-28) and [`v0.1.0`](https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0), the first stable one (2026-10-26). It is unsigned and not notarized, like every build so far; the known limits are in [docs/limits.md](docs/limits.md) and in the Settings.
> - What changed in each release is in the [CHANGELOG](CHANGELOG.md).
> - **Where it has been run:** Linux by hand every day; macOS by hand on two Macs (macOS 26, Apple Silicon); Windows by hand on one real PC, once (2026-10-21), with findings filed. CI builds and starts the packaged app and runs the UI checks on Linux, macOS and Windows. The detail, with the real-account runs, is in [docs/limits.md](docs/limits.md#where-it-has-been-run).
> - Built by [Three Feathers](https://github.com/three-feathers), tracked on the [project board](https://github.com/orgs/three-feathers/projects/1).

![15 simulated agents at 1440x900](docs/screenshots/m5-sim15-1440x900-closed.png)

> **Disclaimer.** Agent Durbar is an independent community project. It is **not affiliated with, endorsed by or sponsored by GitHub, Microsoft, Anthropic or OpenAI**. "GitHub Copilot", "Visual Studio Code", "Claude" and "Codex" are trademarks of their owners. Durbar only drives the tools you installed yourself, on your own machine.

## What it does

- **An office, not a log:** every agent is a person at a desk in its folder's room; you see at a glance who is working, waiting for you or in trouble. 15 agents fit one screen.
- **Full-screen chat** with thinking, tool calls, diffs, questions and file attachments streaming live; a browser tab in every chat.
- **Three agent apps side by side:** Copilot, Claude Code and Codex, with one set of permission modes and model, context and spending controls.
- **Needs you:** one inbox of every agent waiting for an answer or a permission, oldest first.
- **Sessions that last:** resume after a restart or a crash, scheduled prompts, undo an agent's file changes, notes, continue in another app.
- **MCP servers** shared across your agent apps, with health, sign-in and per-tool switches.
- **Six themes** and a theme maker.
- **My characters**, your own people at the desks, on any theme ([spec 096](specs/096-ai-character-maker/spec.md)). `[KNOWN GAP]` Nothing can make one yet: Codex image generation stays off until it has been tested with a real Codex, so *Make a character with AI…* says so; everything else is checked on the simulator's fake generator only. When it is on, Codex keeps its own copy of each picture under `~/.codex/generated_images/`; Durbar neither reads nor deletes it, and keeps nothing from your description.

![Full-screen chat with the other agents in a slim strip, 1280x800](docs/screenshots/m6-fullchat-sim15-1280x800.png)

Every feature, with its limits: [docs/features.md](docs/features.md).

## Install

Download the build for your system from the [Releases page](https://github.com/three-feathers/agent-durbar/releases) (macOS `.dmg`, Windows `.exe`, Linux `.AppImage`) and check it against `SHA256SUMS.txt`. There is no auto-update. You also need at least one agent app (Copilot, Claude Code or Codex); **Settings > Agent apps** can install it for you.

**The builds are not code-signed** (certificates cost money), so your OS warns you the first time. Only open files from this repository's Releases page.
- **macOS:** right-click the app and choose **Open**, or allow it in System Settings > Privacy & Security.
- **Windows:** on "Windows protected your PC", click **More info**, then **Run anyway**.
- **Linux:** run `chmod +x Agent-Durbar-*.AppImage && ./Agent-Durbar-*.AppImage` (it needs FUSE 2, see the details).

Every file, the Windows and Mac notes, verifying a download and the requirements: [docs/install.md](docs/install.md).

## Safety model

Agents run **locally, on your machine, as you**, in the folders you add. Every agent has a permission mode, named the same for every harness:

- **Read-only** (the default): reads inside the session's folders only; everything else is denied.
- **Ask first**: writes, shell commands, URLs and tools wait for *Allow once*, *Allow for this session* or *Deny*.
- **Allow all**: no prompts. Use it only in folders you trust; it asks once to confirm.

Durbar never sees, stores or sends your tokens (each agent app reads its own sign-in) and has no accounts, servers or telemetry. Usage bills against **your** plans; a per-session spending limit is a soft limit. Details and spending caps: [docs/safety.md](docs/safety.md). Report a problem: [SECURITY.md](SECURITY.md).

## Quick start

1. Install an agent app and sign in to it, then start Agent Durbar.
2. **+ Folder** (Ctrl+O) adds a folder as a room; pick the agent app and keep **Read-only** until you trust the folder.
3. Click an agent to chat. Press **I** (or Ctrl+Shift+A) for everyone waiting for you, **Ctrl+K** for the command palette, **?** for all shortcuts.

No agent app yet, or just curious? `DURBAR_SIM=15 npm start` from source shows 15 simulated agents: no sessions, no AI credits.

## Development

```bash
npm ci
npm run typecheck && npm run build && npm test
npm start                 # the app; DURBAR_SIM=15 npm start for 15 simulated agents, no AI credits
```

All `npm run` commands, the repository layout and how we work (spec-driven with [GitHub Spec Kit](https://github.com/github/spec-kit): no code without a spec, a plan and tasks): [docs/development.md](docs/development.md), [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md).

## More documentation

- [Features](docs/features.md) · [Agent apps](docs/harnesses.md) · [Install](docs/install.md) · [Safety and costs](docs/safety.md) · [Themes](docs/themes.md)
- [Known limits and roadmap](docs/limits.md) · [Development](docs/development.md) · [Feature history](docs/feature-history.md)
- [Specs](specs/README.md) · [Constitution](.specify/memory/constitution.md) · [Collaboration](docs/collaboration.md) · [CHANGELOG](CHANGELOG.md)

## License and credits

[MIT](LICENSE), Copyright (c) 2026 Three Feathers contributors.

Agent Durbar is by **Three Feathers**. Key contributors: [vikramgorla](https://github.com/vikramgorla), [fjcabello](https://github.com/fjcabello) and [rubenlupi](https://github.com/rubenlupi) (GitHub handles are used as the names). The names live in [`src/shared/about.ts`](src/shared/about.ts) and are shown in the OS About panel and in Settings > About.

The Cheeky and Prehistoric Crew pictures (`src/renderer/crew/art/`) were made by Paco with ChatGPT image generation, and Paco did the final pass; [`ASSETS.md`](src/renderer/crew/art/ASSETS.md) gives the tool and date of each (spec 077). The app id is `io.github.three-feathers.agentdurbar` since 2026-10-16; a build from before then is a separate app to the OS.

See also [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the [CHANGELOG](CHANGELOG.md).

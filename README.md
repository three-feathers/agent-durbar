# Agent Durbar

Command center to see, chat with and coordinate coding agents (Copilot CLI first) in an office-style view.

> Status: early scaffold. The window shows the static office-view prototype; no agent runtime is wired up yet.

![Office view prototype](prototype/office_1280.png)

## Vision

- **See**: every running coding agent at a glance, what it is doing now, and its state (idle / working / needs permission / error).
- **Control**: start, stop and message agents; approve or deny permission prompts.
- **Coordinate**: group agents by project/folder and watch them work in parallel.
- **Office view**: each agent is a person in a room; sub-agents appear next to the agent that spawned them.
- **Chat with live thinking**: open any agent and talk to it while its reasoning, tool calls and output stream in.
- **Attach files and images** to messages.
- **Open VS Code** on an agent's folder or workspace in one click.
- **10-15 agents on one screen** without it turning into noise.

Prototype: [`prototype/index.html`](prototype/index.html) (open in a browser). Screenshots: [office](prototype/office_1280.png), [chat panel](prototype/panel_1280.png).

## Decisions

- **Electron + TypeScript**, using the official **`@github/copilot-sdk`** (Node/TS) in the main process. Lowest-risk path to streaming events including sub-agent identity (`agentId`, `subagent.*`).
- **One session per folder or `.code-workspace` file.**
- **Adapter interface** ([`src/adapters/types.ts`](src/adapters/types.ts)): `start`, `send`, `stop`, `onEvent` with normalized events (`status`, `thinking`, `output`, `toolCall`, `subagent`). Copilot is first; Claude and Codex CLIs can be added later without touching the UI.
- Full background and sources: [`docs/research.md`](docs/research.md).

## Known limits

- **Sessions started in VS Code are read-only** (no API to control them; only fragile parsing of files on disk). Live control works for sessions Agent Durbar starts itself.
- **ACP drops sub-agent identity**: sub-agent text arrives as plain message chunks, so parallel sub-agents interleave. Hence the SDK rather than raw ACP.
- **AI credit usage**: since 2026-06-01 Copilot is billed in usage-based AI Credits, and 10-15 agents can burn them fast. Show a **per-agent credit counter** and support a per-session cap.
- Permission prompts need a real approve/deny UI; allow-all across 15 agents is risky.
- SDK/ACP/AHP protocols are evolving; pin CLI and SDK versions.
- Overlap with the GitHub Copilot app and the VS Code Agents window; the office view is the differentiator.

## MVP milestone

An Electron app that:

1. lets you pick N folders,
2. starts one SDK session per folder with streaming,
3. shows a grid of 10-15 agent cards with state, current intent, last tool and nested sub-agent chips,
4. opens a chat panel with live thinking, output and tool calls, plus file/image attach,
5. has an "Open in VS Code" button and a per-agent AI-credit counter.

## Roadmap

- [x] Repo, prototype, research, Electron + TypeScript skeleton, `AgentAdapter` interface
- [ ] Copilot adapter on `@github/copilot-sdk` (start/send/stop, event mapping)
- [ ] Wire office view to live adapter events
- [ ] Chat panel with streaming thinking, attachments
- [ ] Permission approve/deny flow
- [ ] AI-credit counter and caps
- [ ] Resume sessions; read-only discovery of VS Code / terminal sessions
- [ ] Open in VS Code (`code <folder>`)
- [ ] Second adapter (Claude or Codex CLI)
- [ ] Packaging (macOS, Windows, Linux)

## Development

```bash
npm install
npm run build   # tsc + copy prototype into dist/renderer
npm start       # build and launch Electron
```

Layout: `src/main` (Electron main), `src/preload` (bridge), `src/renderer` (UI), `src/adapters` (agent adapters), `prototype/` (static design), `docs/` (research).

## License

MIT, Vikram Gorla.

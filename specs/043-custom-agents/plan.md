# Implementation Plan: Custom agent per session

**Branch**: `043-custom-agents` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

## Summary

A generic "agent profile" in the adapter interface; Copilot maps it to the SDK's `rpc.agent.*` with explicit agent folders; main guards repository agents with a saved confirmation; the renderer adds an Agent chip and menu in the chat header, a confirmation dialog and a waiting switch. Simulator first, then one real check.

## Technical Context

**Language/Version**: TypeScript (main, adapters), plain JS (renderer), Electron 44.
**Primary Dependencies**: `@github/copilot-sdk` 1.0.22 (`rpc.agent.list/select/deselect/getCurrent`, `agentDirectories`, events `subagent.selected` / `subagent.deselected`; all `@experimental`).
**Storage**: confirmations in the existing settings store (`durbar-settings.json`): `{ folder, agentId, sha256 }`, at most 200, no file content.
**Testing**: unit tests on a fake Copilot session (`test:copilotmodel`), a new `test:agentprofiles` (store, IPC validation, mapping), simulator drivers, one real check.
**Target Platform**: Windows, macOS, Linux (paths with `path.join`, `os.homedir()`).
**Constraints**: constitution I (no Copilot types outside the adapter), II/III (safe by default: the permission broker still sees every tool call; repository agents need a confirmation), IV (simulator first), V (10.5 px text, 15 agents fit).

## Constitution Check

- I Adapters are plug-ins: profile type and event in `src/adapters/types.ts`, generic; Copilot specifics in `copilot.ts`. Pass.
- II/III Safe by default: the session's mode is not changed; repository agents are confirmed with their tools, model and MCP servers shown; no config discovery (no repository skills). Pass.
- IV Do not spend credits: simulator and unit tests; one real check (owner's standing permission). Pass.
- V Calm UI: one chip in the chat header (fits at 1280x800 with the other chips), menu like the model menu. Check with screenshots. Pass.
- VI Parity: paths built with `path` and `os.homedir()`. Pass.
- VIII Honest limits: `@experimental` SDK calls and what was not run are recorded. Pass.

## Design

1. `types.ts`: `AgentProfile`, `AgentProfileEvent` (`type: 'agentProfile'`, `profile: AgentProfile | null`), optional `listAgentProfiles`, `selectAgentProfile`.
2. `copilot.ts`: `agentDirectories` in the session config; `profileOf(AgentInfo)` (pure, exported for tests); list/select/deselect; `getCurrent` after create/resume emits `agentProfile`; map the two events in `map.ts`.
3. `src/main/agentprofiles.ts` (pure + fs): `hashFile(path)`, confirmation store helpers on the settings store; IPC handlers in `main.ts`.
4. Renderer: `agentChipHTML`, `openAgentMenu`, `confirmRepoAgent` (dialog.js `askDialog`), waiting switch (`a.pendingProfile`), Stop drop; card subtitle.
5. Simulator: `SIM_PROFILES`, `listAgentProfiles` / `selectAgentProfile` on the fake bridge, events.

# Tasks: Custom agent per session (043)

## Phase 1

- [x] T001 Types: `AgentProfile`, `agentProfile` event, optional adapter members (generic) [FR-001]
- [x] T002 Copilot: `agentDirectories`, list/select/deselect/getCurrent, event mapping; fake-session tests [FR-002, FR-006]
- [x] T003 Main: IPC `agents:listProfiles` / `agents:selectProfile`, repository confirmation (hash, store); tests [FR-003, FR-006]
- [x] T004 Renderer: Agent chip and menu, repository dialog, waiting switch and Stop drop, card subtitle [FR-004]
- [x] T005 Simulator profiles and events; screenshots at 1440x900 and 1280x800; `check:office` [FR-005]
- [x] T006 (real-account, owner allowed) Free plan, throwaway folder with one repository agent: list, select, reply follows the agent, deselect [FR-006]
- [x] T007 Docs: README, CHANGELOG, specs index [all]

## Phase 2 (not started)

- [x] T010a (2026-10-19) Agent in the New session dialog (same list and confirmation as the chip; applied when the session has started)
- [ ] T010 Per-folder default agent
- [ ] T011 Claude and Codex mapping (spec 012); Claude half: T011a
- [ ] T011a (Claude) agent files listed by the adapter, `--agents`/`--agent` on relaunch [FR-008]

# Plan 066

1. Types (`types.ts`, `capabilities.ts`): `AgentMessage.plan`, `PlanEvent`, `PlanAnswer`, `resolvePlan`, `planMode`; `eventguard` accepts `plan`.
2. Adapters: Copilot (`mode.set` + `onExitPlanModeRequest`), Claude (`set_permission_mode` + `ExitPlanMode` in `can_use_tool` and the hook), Codex (`collaborationMode` + the `plan` item).
3. Main: `agents:send` option, window-only `agents:resolvePlan`, preload and api.
4. Renderer: mode-menu entry, composer chip, plan card, attention state.
5. Simulator: `planMode` and the proposed-plan flow.
6. Tests: unit tests per adapter on the fakes, the IPC guard, a driver with screenshots at both sizes. Real: one tiny plan per app.

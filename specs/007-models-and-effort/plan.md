# Implementation Plan (as built): Models and reasoning effort

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

`CopilotAdapter.listModelOptions()` maps SDK `ModelInfo` to `ModelOption`; main exposes it as `models:list` (disabled models filtered); the renderer fills the top-bar and dialog pickers and shows a chip. Choices travel as `SessionOptions` into `startOptionsFor()` and are saved with the folder.

## Technical Context

- **Files**: `src/adapters/copilot.ts` (`listModels`, `listModelOptions`, `cheapestModel`, `start` config), `src/main/main.ts` (`DEFAULT_MODEL`, `EFFORTS`, `asEffort`, `startOptionsFor`, `models:list`), `src/shared/api.ts` (`ModelChoice`, `SessionOptions`), `src/renderer/app.js` (`loadModels`, `fillModelSelect`, `fillEffortSelect`, `modelLabel`, `newSession`), `src/renderer/sim.ts` (canned models).
- **Testing**: none automated (SDK-dependent).
- **Constraints**: listing must not spend credits.

## Constitution Check

| Principle | Result |
| --- | --- |
| II Adapter plug-in | Model list is an optional bridge call (`listModels?`); UI works without it. OK |
| IV No credits | Listing is free; sim has canned models. OK |
| VIII Honest limits | README says "default Auto, with the account's credit multiplier when the API reports one"; FR-006 (never run on a multi-model account) is only implied. **Partial** |

## As-built architecture

```text
renderer loadModels -> bridge.listModels -> main models:list -> adapter.listModelOptions -> client.listModels()
renderer addVia / newSession -> {model, effort} -> main sessionOpts/asEffort -> addWorkspace -> startOptionsFor
   -> adapter.start({model, reasoningEffort?, autoTier: model==='auto' ? 'efficiency' : undefined})
```

## Project Structure (documentation)

```text
specs/007-models-and-effort/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Pickers, chip, dialog | simulator + screenshots `m6-new-session-dialog.png` | `sim:` recorded |
| Real model list with one model (`auto`) | README m1 smoke | `real:` recorded |
| Real list with several models/efforts | none | **not verified** |
| Typecheck/build | CI and local | pass 2026-10-16 |

## 2026-10-23 delta: Auto routing tier (issue #607, FR-012..FR-018)

```text
adapter.listModelOptions -> client.listModels() + client.getStatus().version (>= 1.0.87 -> auto.autoTiers)
                          + client.rpc.managedSettings.resolve({}) -> managedAutoTierFrom() -> auto.autoTierManaged {tier, locked}
renderer openModelMenu (agent on auto, option lists tiers) -> "Auto routing" .mm-seg -> chooseModel({model:'auto', autoTier})
   -> autoTierConfirm(from, to) -> askDialog for a higher tier -> bridge.setModel -> main parseSwitchRequest (allow-list, lock)
   -> CopilotAdapter.setModel -> rpc.model.switchTo({modelId:'auto', autoTier}) (no autoTier under a lock)
applied -> AgentInfo.autoTier, folderStore.setModelChoice({autoTier}) -> next start: startOptionsOf -> StartOptions.autoTier (saved)
   -> modelConfig(create|resume): saved tier -> capi.autoTier; none -> new auto: efficiency (or nothing under a managed tier); resume: nothing
```

- **Files**: `src/shared/modelswitch.ts` (types, `parseAutoTier`, validation), `src/shared/api.ts` (`AgentInfo.autoTier`, `ModelChoice` fields), `src/adapters/copilotmodel.ts` (pure: `withAutoTiers`, `managedAutoTierFrom`, `modelConfig`), `src/adapters/copilot.ts` (list, start, `setModel`), `src/adapters/map.ts` + `types.ts` (`model` event `autoTier`), `src/main/{main,folders,startopts}.ts`, `src/main/ipc/model.ts`, `src/renderer/{app.js,modelswitch.js,sim.ts}`.
- **Reuse** (AGENTS.md "Look for an existing capability first"): the chat's model menu (`openModelMenu`, its `.mm-seg` group as for effort), `chooseModel`/`sendModelChange`/`undoModel`, `askDialog`, IPC `agents:setModel`, `parseSwitchRequest`, `FolderStore.setModelChoice`. No new channel, no new popup.
- **PR #632** (compact composer toolbar) changes `modelChipHTML`, the return line of `modelLabel` and adds a "Context window" block after the effort group. This delta adds its lines before the effort group and changes only the `eff` line of `modelLabel`, so the two merge without overlap.
- **Tests**: `scripts/test-modelswitch.ts` (validation, `autoTierConfirm`), `scripts/test-copilot-model.ts` (fake client: version gate, managed parse incl. hostile shapes, create/resume config, `switchTo` params), `scripts/test-folders.ts` (round trip, bad values dropped), `scripts/test-sim-model.ts`; driver `scripts/shots-007-autotier.js`.

| Principle | Check |
| --- | --- |
| II Adapter plug-in | Tier data is an optional field of the neutral `ModelChoice`; only the Copilot adapter fills it; the renderer shows the group only when the field is there. OK |
| III Safe by default | Tier validated in main against an allow-list and the lock; the policy is read through the runtime only, parsed all-or-nothing from own properties. OK |
| IV No credits | Listing, status and managed settings cost nothing; tests use fakes; the real switch is T033 (owner approval). OK |
| V Calm UI | A three-button group like effort, inside the existing menu; no chip text change unless a tier was chosen. OK |
| VIII Honest limits | Known gaps listed in the spec delta and README. OK |

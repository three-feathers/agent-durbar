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

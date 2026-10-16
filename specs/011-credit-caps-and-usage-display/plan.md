# Plan: 011 credit cap slice (2026-10-16)

## Adapter layer
- `src/adapters/types.ts`: `LimitEvent` (`type: 'limit'`) added to `AgentEvent`; `StartOptions.maxAiCredits` documented as the cap; `AgentAdapter.setCap?`, `resolveLimit?` (optional: other adapters need not support caps, spec 012).
- `src/adapters/map.ts`: `session_limits_exhausted.requested|completed`, `session.session_limits_changed` -> `limit`. Pure, tested with fixtures.
- `src/adapters/copilot.ts`: `sessionLimits` in the create/resume config, `registerInterest`, `setCap` (`rpc.options.update`), `resolveLimit` (`rpc.ui.handlePendingSessionLimitsExhausted`), pending limit request remembered per session and answered with `cancel` on interrupt/stop.
- `src/shared/credits.ts` (pure): `parseCap`, `MAX_CAP`, `parseSettings`, `fmtAiu`. No Electron/SDK import, so main, tests and (by copy of the tiny formatter) the renderer agree.

## Main process
- `src/main/settings.ts`: `SettingsStore(file)` JSON, atomic write, tolerant parse (like `FolderStore`). Only `defaultMaxAiCredits`.
- `src/main/folders.ts`: `maxAiCredits?` per saved folder.
- `src/main/main.ts`, `preload.ts`, `shared/api.ts`: IPC above; `startOptionsFor` passes `maxAiCredits`; `AgentInfo.maxAiCredits`.

## Renderer
- `app.js`: usage text with cap, cap chip + dialog in the chat header, `limit` event handling (state `Limit reached`, inline notice with Add/Remove/Stop), new-session dialog field. `screens.js`: Settings "Credit cap". `styles.css`/`screens.css`: chip and notice.
- `sim.ts`: caps, usage accumulation, `limit` events, in-memory settings.

## Risks
- `sessionLimits` is `@experimental` in SDK 1.0.22 -> exact pin + documented upgrade step.
- Behavior after `cancel`, hard/soft and AIU vs credit unit are unverified (FR-015).
- The card usage text gets longer; `npm run check:office` must stay green (minimum 10.5px, no overlap).

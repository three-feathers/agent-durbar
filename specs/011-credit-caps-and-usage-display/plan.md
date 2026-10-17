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

# Plan: 011 office and folder usage totals (2026-10-17, issue #8)

## Renderer only (no main, preload, adapter or IPC change)
- New `src/renderer/usagetotals.js` (pure, UMD: `window.DurbarUsage` / `module.exports`): `createLedger()` with `record(roomId, {inputTokens, outputTokens, nanoAiu})`, `office()`, `room(id)`, `roomIds()`; `validNano(x)`; `fmtTotal(t, digits)` → `'1.23 AIU'` / `'credits not reported'` / `''` (no calls); `fmtShort(t)` for the plate (`'0.42 AIU'` / `'n/r'`); `tooltip(t, {scope, removedRooms})` text. No DOM, no Electron.
- `scripts/copy-assets.js` and `index.html`: ship and load `usagetotals.js` before `app.js`.
- `app.js`:
  - One ledger for the run. In the main `usage` case and in `onSubEvent` (helper usage): `LEDGER.record(roomOf(root).id, e)` **once per event** (the helper path records for the parent's room and must not record again through the parent).
  - `renderStats()`: append the chip (`<span class="stat stat-aiu" role="note">`, not a button) when `LEDGER.office().calls > 0`; `title` from `tooltip()`. Mark "includes folders no longer shown" when a ledger room id is not in `ROOMS`.
  - Room header (`room-head`): `<span class="room-aiu" title="…">0.42 AIU</span>` after `room-dots` when the room has calls. Door plate (`plateHTML`): short total in the plate text and aria-label.
  - Demo/sample mode is not fed by events, so nothing shows there.
- `styles.css`: `.stat-aiu` (same pill as `.stat`, no dot, not clickable), `.room-aiu` (muted, `font-size` >= 10.5px, `white-space:nowrap`, shrinks before the path).
- `sim.ts`: unchanged (it already emits `usage` with `nanoAiu`, also for helpers). The not-reported case is covered by unit tests, not the simulator.

## Tests and checks
- `scripts/test-usagetotals.ts` + `package.json` `test:usagetotals` in the `test` chain.
- `npm run check:office` (95 checks) must stay green; screenshots at 1440x900 and 1280x800 (`DURBAR_SIM=15`), header and one closed door.

## Constitution check
- I: this delta + tasks before code. II: renderer consumes normalized `usage` events only. III/VII: numbers only, nothing stored or sent (FR-007). IV: simulator and unit tests only, 0 AIU. V: FR-022. VI: no platform code. VIII: tooltip says "as reported", unit unverified against billing.

## Risks
- Double counting helpers (parent and sub both see usage): one `record` per event, covered by a test that replays a helper event.
- Header width at 1280x800 with the extra chip: checked by `check:office` and screenshots; fall back to dropping the word "AIU" into the tooltip if it does not fit.

## Verification (2026-10-17)
- `npm run typecheck && npm run build && npm test` (incl. `test:usagetotals`), `npm run check:office` 95/95, on macOS, after merging main (#15, #16).
- Simulator (`DURBAR_SIM=15`, 1440x900 and 1280x800): header chip `33.56 AIU` equals the sum of the folder totals (SC-001); closed `blog` plate shows `0.06 AIU` and its aria-label says it; smallest new text 11px; no horizontal overflow. Screenshots: `docs/screenshots/011-usage-totals-1440x900.png`, `docs/screenshots/011-usage-totals-1280x800.png`.
- Fixed during review: (1) the status-counter click handler matched any `.stat`, so clicking the chip cleared the active filter; it now matches `.stat[data-k]` only (FR-019 "not a filter"). (2) The folder total shrank to "0.16 A..." and pushed `swisscontract-ai` into an ellipsis; the total no longer shrinks and, when a room shows a total, the path gives way before the name (selector made specific enough to beat the compact-density rules).
- `/speckit-analyze` and `/speckit-converge` followed by hand (feature dir 011): converged for FR-018..FR-023, no tasks appended.
- Not verified: a real Copilot session (0 AIU spent), Windows and Linux rendering, the "credits not reported" chip on screen (covered by unit tests only; the simulator always reports credits).
- Self-review against the maintainer's review checklist: stale "office totals are backlog" text fixed in the spec status, the "What exists today" gap line and the tasks backlog line (older delta history left as is); FR-021 no longer claims `sim:` (the simulator always reports credits). Mutation check: five deliberate breaks of `usagetotals.js` (accept any nano, never count unreported, double-count the office, show 0.00 for not reported, sum raw token fields) each make `test:usagetotals` fail. The `app.js` wiring (record calls, chip click) is checked on the simulator only, not by `npm test`. Demo mode hides the chip and folder totals and they come back when it is turned off.

# Plan: 011 usage totals kept across restarts (2026-10-17, issue #21)

## Constitution check
- I: spec delta, plan and tasks before code. II: main records the normalized `usage` event only; the renderer stays agent-neutral. III/VII: numbers, display names and path hashes only on disk; IPC validated; no paths read back from disk. IV: unit tests, simulator, 0 AIU. V: no new UI in the office (chip and room totals unchanged in shape); Settings part follows the Credit cap section. VI: hash input normalised per platform (case-folded on Windows). VIII: tooltip says "as reported", the reset and its scope are stated in Settings.

## Main process
- `src/shared/usagedoc.ts` (pure, no Node): types, `emptyUsageDoc(now)`, `recordUsage`, `sanitizeUsageDoc`, `officeTotals`, `normaliseFolderKey(p, platform)` (string work only; hashing is in main).
- `src/main/usagetotalsstore.ts`: like `src/main/usagestore.ts` (injectable timers and clock, 2 s debounce, atomic tmp+rename, 2 MB cap, `lastError`); `keyFor(folderKey)` = SHA-256 hex prefix of the normalised key.
- `src/main/main.ts`: `adapter.onEvent` for `usage` -> `usageTotalsStore.record(keyFor(a.workspaceFile ?? a.cwd), displayName(a), e)`; IPC `usage:totals` (folders of current agents with their path, office sum) and `usage:resetTotals`; flush on `will-quit` next to the tool-usage flush.
- `src/preload/preload.ts`, `src/shared/api.ts`: `usageTotals()`, `usageResetTotals()`, `UsageTotalsView`.

## Renderer
- `src/renderer/usagetotals.js`: `createLedger({baseline})` or `ledger.setBaseline({office, folders:Map(key->totals)})`; `room()`/`office()` return baseline + run; a `run()` view for the tooltip; existing formatting kept. Tests extended.
- `app.js`: load the baseline after `listAgents` (and after a reset), map folders by key (`workspaceFile ?? cwd`) to rooms; the tooltip line "since the app opened" uses the run part.
- `screens.js`: Settings "Usage totals" part with the reset and a confirmation through `window.DurbarDialog(document)` (`dialog.js`, focus-trapped); `X.onUsageReset()` hook so app.js reloads the baseline.
- `sim.ts`: in-memory bridge with a seeded baseline; `simunreported=<room>` query (read with the other sim query params in `app.js`).

## Tests and checks
- `scripts/test-usagedoc.ts` (new, in `npm test`): validation, recording, reset/since, caps, sanitize of hostile input, office sum with folders no longer listed, no path in the serialised document; store debounce/flush/reset with a temp dir and fake timers.
- `scripts/test-usagetotals.ts`: baseline + run sums, run-only tooltip line.
- `npm run check:office` unchanged layout; screenshots with a simulator driver `scripts/shots-021.js` (seeded baseline, `simunreported=blog`, Settings part and confirm).

## Risks
- Double counting if both the renderer and main persisted: only main writes; the renderer only adds this run on top of a baseline taken at start.
- A reset while agents are working: the renderer zeroes its run ledger at the same moment it reloads the (empty) baseline.
- Workspace vs folder keys must match between main (`workspaceFile ?? cwd`) and the renderer (`folderOfRoom`); a test fixture covers a workspace agent.

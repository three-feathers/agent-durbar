# Tasks: 011 credit cap slice

- [x] T001 Spec delta + clarifications + plan (this folder) before code [FR-009..FR-017]
- [x] T002 `shared/credits.ts` + `main/settings.ts` + folder store cap, with tests (`scripts/test-credits.ts`, `test-folders.ts`) [FR-012, FR-017]
- [x] T003 Mapper: `limit` events + fixtures/tests [FR-010, FR-017]
- [x] T004 Copilot adapter: sessionLimits on create/resume, interest, setCap, resolveLimit, cancel on stop [FR-009, FR-011]
- [x] T005 Main + preload + api: IPC, startOptions, AgentInfo [FR-012]
- [x] T006 Simulator: caps, usage, limit events, settings bridge [FR-016]
- [x] T007 Renderer: usage vs cap on cards/header, cap chip + dialog, Limit reached state + notice, new-session field, Settings section [FR-013, FR-014]
- [x] T008 Pin the SDK exactly in package.json + package-lock, document upgrading in CONTRIBUTING.md [Packaging]
- [x] T009 Screenshots (simulator), `npm run check:office` still green
- [x] T010 Real-runtime check: session create/update with a cap, no prompt (0 AIU); exhausted flow not run (30-credit minimum), recorded under Verification [FR-015, SC-002]
- [x] T011 Converge spec/plan/tasks, README roadmap, specs index

Backlog: capability flag (spec 012). (Office and per-folder totals: done 2026-10-17, T012-T019; kept across restarts: done 2026-10-17, T020-T027; multiplier estimate: covered by spec 030.)

## Office and folder usage totals (2026-10-17, issue #8)

- [x] T012 Spec delta + clarifications + plan before code [FR-018..FR-023]
- [x] T013 `src/renderer/usagetotals.js` (pure ledger, validNano, formatters, tooltip) + `scripts/test-usagetotals.ts` + `test:usagetotals` in `npm test` [FR-018, FR-021, FR-023]
- [x] T014 Ship and load it: `scripts/copy-assets.js`, `index.html` [FR-018]
- [x] T015 `app.js`: record every `usage` event once (main and helper paths) in one run-long ledger [FR-018]
- [x] T016 Header chip after the status counters, tooltip, hidden with no usage [FR-019, FR-021]
- [x] T017 Folder total in the room header and on the closed door plate (text + aria-label) [FR-020, FR-021]
- [x] T018 Styles `.stat-aiu`, `.room-aiu`; `npm run check:office` green at 1440x900 and 1280x800 [FR-022]
- [x] T019 Screenshots (simulator, both sizes, one closed door), README status line, specs index [FR-023, SC-001]

## Usage totals kept across restarts (2026-10-17, issue #21)

- [x] T020 Spec delta (second 2026-10-17 delta) + clarifications + plan before code; User Story 3 marked covered by spec 030 [FR-024..FR-030]
- [x] T021 `src/shared/usagedoc.ts` + `scripts/test-usagedoc.ts` (in `npm test`) [FR-024, FR-030]
- [x] T022 `src/main/usagetotalsstore.ts` (debounce, atomic write, flush, reset, hash key) + tests [FR-025, FR-030]
- [x] T023 Main recording from `usage` events, IPC `usage:totals` / `usage:resetTotals`, preload, `api.ts`, flush on quit [FR-026]
- [x] T024 Renderer baseline + run in `usagetotals.js` and `app.js` (folder key match, tooltip "since the app opened"); tests [FR-027]
- [x] T025 Settings "Usage totals" part with Reset and confirmation [FR-028]
- [x] T026 Simulator bridge with seeded baseline; `simunreported=<room>` [FR-029]
- [x] T027 Screenshots (`scripts/shots-021.js`): chip after a restart, "credits not reported" room, Settings part and confirmation, both sizes; README, CHANGELOG, specs index [FR-030]

## 2026-10-20: Durbar enforces the Copilot cap (FR-070..FR-074)

- [x] T040 Copilot adapter: used-credit tracking, hold before send, stop on crossing during a turn, local `resolveLimit`, Stop/End drop [FR-070..FR-074]
- [x] T041 Unit tests on a fake session (`scripts/test-copilot-cap.ts`, in `npm test`) [FR-070..FR-074]
- [x] T042 One real check on Copilot Pro (cheap model, under 3 credits), README *Costs and caps*, CHANGELOG [FR-071] Done 2026-10-20: 1.46 AIU (spec `## Changes`).

## 2026-10-31: account quota per agent app (issue #690, FR-080..FR-094)

- [x] T050 `src/shared/quota.ts`: contract, sanitising, read steps, display rows, near limit, alternatives, `quotaLine`; `usagelimit.ts` shares its time parsing [FR-080, FR-082, FR-084, FR-085, FR-087]
- [x] T051 `accountQuota()` for Copilot and Codex, `quotamap.ts`, the capability, the contract and simulator lists; fakes [FR-081, FR-091]
- [x] T052 `src/main/quota.ts`, IPC `harness:quota` in the allow lists, preload, `DurbarApi` [FR-083, FR-090]
- [x] T053 Settings card block and its one timer; suggestion; the New session line [FR-085, FR-086, FR-088, FR-089]
- [x] T054 Simulator fixtures per app [FR-092]
- [x] T055 `scripts/test-quota.ts`, mutants [FR-093]
- [x] T056 `scripts/shots-011-quota.js`, pictures at both sizes [FR-093]
- [x] T057 Docs, agent-apps, changelog fragment, specs 012 and 051 cross-references
- [x] T058 Review of 7a179ce4: unusable windows read "not reported", `resetDate` only, below-zero percent, the account fingerprint and its label; tests, mutants [FR-082, FR-095]
- [x] T059 `real:` 2026-11-02 (owner's OK): check the real shapes of `account.getQuota` and `account/rateLimits/read`, field names and printing nothing personal; free calls, no prompt, cost limit 0 credits [issue #690] Result: free, shapes as mapped, `tokenBasedBilling` finding in spec *Changes* 2026-11-02

## 2026-11-02: settings setters check the save (issue #1023)

- [x] T070 `SettingsStore.commit(next, keep?)` shared by every setter: truth values roll back, convenience and safer changes stay for the run and are listed per setting (`isUnsaved`); `settings:*` replies `ok` only when the value asked for is in force; `scripts/test-credits.ts` unwritable-path and IPC cases [FR-012]
- [x] T071 Window side of #1023: one `saveFailed` helper in `screens.js` (and the Agent apps checkbox) for every settings row; `scripts/check-settings-save.js` in the UI suite [FR-012]

## 2026-11-04: settings `ok` from the write, no `.tmp` (issues #1094, #1047)

- [x] T072 Setters behind `setting()` return `{ ok, value }` (`Saved<T>`), `ok` from `commit()`; `SettingsStore.save()` removes its `.tmp` in a `finally`; `setChatLinksNewTab` and `setSandboxAlwaysContinue` too, callers in `browser/tabs.ts` and `sandboxops.ts` read `ok`; `scripts/test-credits.ts` unchanged-value, injected partial-write and failed-rename cases [FR-012]

## 2026-11-10: a monthly reset that does not move with the minute (FR-092)

- [x] T073 `sim.ts` `simQuotaFixture`: the request modes' and `usagebilled`'s `resetsAt` is the next UTC midnight 12 days on (`MONTHLY`), so the theme-geometry Photo/Retro Settings comparison cannot see "06:10" against "06:11" (merge-queue run 42766660661).

## 2026-11-13: the runtime's limit prompt at 90% (FR-096; spec 058 FR-244, issue #1667)

- [ ] T074 With the SDK 1.0.32 bump (spec 058 T216): `map.ts` marks a runtime limit request with `used < max` as near; the window's note, card state and office signs say "Close to the spending limit" for it, "reached" otherwise (also for a missing or non-finite number); mapper, window and card tests with the `<=`, finite-check and card-sign mutants [FR-096]

# Implementation Plan: 068 Coffee break when a usage limit is reached

**Spec**: [spec.md](spec.md) · **Branch**: `068-coffee-break` · **Date**: 2026-10-21

## Technical context

Electron app; main and adapters in TypeScript, renderer in plain JS (UMD helper modules tested in Node). No new dependency. Tests: `scripts/test-*.ts` (no credits), simulator drivers `scripts/shots-*.js`, `check:office` and `check:geometry` for layout.

## Constitution check

- I Spec Kit: spec, plan and tasks committed before `src/` changes.
- II Adapters are plug-ins: one new normalized event `usageLimit` in `src/adapters/types.ts`; each adapter maps its own signal; the renderer and `src/shared` never see a vendor field.
- III Safe by default: no probe; one fixed resume message; never past a Durbar cap; nothing written to disk but one setting (`breakResume: 'ask'`, a word); `source` is a fixed label chosen by the adapter, never provider text.
- IV No credits: simulator (`simbreak=N`), fixtures and fake clocks only.
- V Calm UI: no ambulance, siren or faint on a break; text ≥ 10.5px; 15 agents at 1440x900 and 1280x800 with the sixth tile (`check:office`).
- VI Parity: epoch ms + `Intl.DateTimeFormat`; no OS scheduler or shell.
- VIII Honest limits: real limit shapes stay `[KNOWN GAP]` (no real session driven into a limit).

## Design

1. **Event** (`src/adapters/types.ts`, `eventguard.ts`): `UsageLimitEvent { type:'usageLimit', scope:'plan'|'quota'|'rate', resetsAt?, estimated?, paid?, source }`. Guard: scope in the set, `resetsAt` finite and > 0, `source` a string ≤ 60 characters.
2. **Adapters** (pure mappers, fixtures):
   - `claudeMap.ts`: `rate_limit_event` with `rate_limit_info.status === 'rejected'` or `errorCode === 'credits_required'` → `usageLimit` (`resetsAt` seconds or ms → ms; `rateLimitType` → source "5-hour window" / "weekly limit" / "weekly Opus limit" / "usage limit"; `credits_required` → `quota`, `paid`). The turn's following error `result` then ends as `idle` "Usage limit reached" instead of an error. A `rejected` event without a later error changes nothing else.
   - `codexMap.ts`: keep the newest `account/rateLimits/updated` snapshot; a failed turn with `UsageLimitExceeded` → `usageLimit` (`plan`, `resetsAt` = the latest `resetsAt` among windows at ≥ 100 %, else none) + `idle` "Usage limit reached".
   - `map.ts` (Copilot): `session.error` `rate_limit` (any code) → `usageLimit` `rate`; `quota` with `quota_exceeded` / `session_quota_exceeded` → `usageLimit` `quota`, `paid`; both followed by `idle` "Usage limit reached". Other quota codes stay errors. `copilot.ts`: for a `quota` break without a reset, one best-effort `account.getQuota` (free read) → a second `usageLimit` (`update: true`, ignored once the break ended) with `resetsAt` from `premium_interactions.resetDate` (helper `copilotQuotaReset`, unit-tested).
3. **Break core** (`src/renderer/coffeebreak.js`, UMD): `createBreaks({now, gapMs:20000, marginMs:60000, rehitMs:120000, lateMs:300000, remindMs:3600000})` with `start(id, {kind, app, resetsAt, estimated, paid, source}, policy)`, `end(id)`, `resumed(id)`, `tick()` → actions `resume | ask | remind`; staggering per app; re-hit rule; words `breakText(b, now, fmt)`; `untilText`.
4. **Renderer** (`app.js`): `usageLimit` → `a.coffee`, `setState(a,'waiting', 'Coffee break', text)`, a chat card `.note.perm.coffee` with **Retry now** (Try now until 2026-10-23) / **Stay on break** (inbox copies them); `limit exhausted` also starts a `durbar-cap` break (card stays the spec 011 one). Idle/error that follow a break keep it; a user send, Stop, end, `working` or `output` end it. A 5 s tick calls `tick()`; `resume` sends the fixed sentence through `sendLive(..., {fromComposer:false})` and adds the note; `ask` swaps the card to **Resume** / **Not now**; `remind` adds one inbox notification (new key).
5. **Places** (`places.js`): `createVisits().pin(id, place)` / `unpin(id)`: a pinned visit ignores tools and statuses; `COFFEE` tile id `coffee` (not in `PLACES`, so never a mapping choice). `app.js`: `lobbyPlaces()` = places + coffee tile; icon (cup); the walker gets `data-coffee` (a cup in its hand, CSS). Desk scene of an agent on a break: empty chair plus the cup.
6. **Mood** (`mood.js`): `troubleOf` returns null for `coffee`; `roomAlertOf` treats it as calm; phrase "On a coffee break".
7. **Words** (`theme.js`, `themegen.ts`): the scene word `place-coffee` ("Coffee corner"), per theme (Corporate "Break room", Retro "Snack bar", Durbar "Chai stall", Victorian "The Tea Room", Japanese "Chashitsu"). "Coffee break" is a status word and stays plain (check:geometry).
8. **Setting**: `breakResume` in `src/shared/credits.ts` parser, `src/main/settings.ts`, IPC `settings:setBreakResume`, preload, `api.ts`, simulator bridge; Settings > Notifications gets the switch "Resume after a coffee break by itself when it costs nothing extra".
9. **MCP read state** (`src/main/mcp/agentstate.ts`): `usageLimit` → waiting "Coffee break"; `limit exhausted` label "Coffee break".
10. **Simulator** (`sim.ts`): `simbreak=N` (seconds, 5-3600): Tomas (Claude-like) hits a 5-hour window resetting in N s instead of the 429; Rosa (Copilot-like) hits the monthly premium quota with no reset; a send before the reset hits it again; Omar keeps his 30 AIU cap.
11. **Tests and drivers**: `test-coffeebreak.ts` (core), mapper fixtures in `test-claude-map`, `test-codex-map`, `test-events` (Copilot), `copilotQuotaReset`, guard, `test-places` (pin), `test-mood`, settings parser, MCP agentstate; `scripts/shots-068-coffee.js` at 1440x900 and 1280x800 (sparse and 15 agents); `check:office` with the coffee tile.

## Risks

- The sixth tile narrows each tile (3 → 2 slots at 1280 px). Accepted if `check:office` passes; otherwise fall back to the cup at the desk (Q3).
- Vendor shapes are read from typings and docs only; tolerant readers, unknown values ignored.

## Delta 2026-10-23: clickable coffee break (owner, #634)

- Reuse: the Boss/Bank entry button (`pv-go`, `data-pvopen`, `openAtRequest`), the shared menu element (`#modeMenu`, as `openPlaceMenu`), the card's resume path (`resumeCoffee`, the timer's own), the answer bar's region style.
- `coffeebreak.js`: `backInText(b, auto, nowMs, marginMs)`: pure, unit-tested.
- `app.js`: `lobbyHTML` makes coffee entries `pv-go` buttons (title/label with `backInText`); a `contextmenu` and Shift+F10/ContextMenu handler on `#stage [data-coffeeid]` (the coffee entries' own attribute) opens `openCoffeeMenu`; `retryCoffee(a)` = `resumeCoffee(a,'user')` (already idempotent: it clears `a.coffee` first); `paintCoffeeBar()` paints `#coffeeBar` (in the panel, above the answer bar) from `startCoffee`, `endCoffee`, `resumeCoffee`, `coffeeTick` and panel open; `wireAnswerBar`'s `waiting()` leaves `.coffee` cards out (the bar shows the oldest other waiting card; Alt+A/S/D never press a coffee button). `coffeeTick` redraws the lobby once a minute while a break with a reset time is on, so "back in" stays true.
- No main, preload, adapter or setting change; no new IPC.
- Review on #640: `resumeCoffee` returns true when it sent; `coffeeNoRetry(a)` gives the reason (spending limit pending, break over); `paintCoffeeBar` sets `disabled` + title on every paint; the menu item is `aria-disabled` with the reason; the core marks `rehit` / `heldByRehit` for FR-024's card words.

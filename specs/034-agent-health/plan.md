# Plan: 034 agents show how they are doing (2026-10-17, issue #20)

## Constitution check
- I: this spec, plan and tasks before code. II: renderer reads normalized events only (`context`, `status`, `toolCall`, `permission`, `limit`). III: one boolean added to the settings file, validated in main. IV: simulator and unit tests, 0 AIU. V: drawings stay inside the scene box, one ambulance, reduced motion respected, serious mode; `check:office` unchanged. VI: no platform code. VIII: card text keeps the facts; the drawing is extra.

## Renderer
- `src/renderer/mood.js` (pure, UMD like `places.js`): `bodyOf`, `troubleOf`, `pickAmbulance`, `createMoodTracker`, phrase helpers for the accessible label. Loaded before `app.js` (`index.html`, `scripts/copy-assets.js`).
- `app.js`: one tracker; feed it main-agent `toolCall`, `status`, `permission` events in `onLiveEvent`; `moodFor(a)` = serious ? none : `{body: bodyOf(ctxPct), trouble}` using `STATS.agent(id).ctx`, `a.limit`, the tracker and `pickAmbulance` over live agents; `scene()` / `sceneC()` take the mood (cache key includes it); card `title`/`aria-label` add the phrases; a 5 s timer re-renders while someone is waiting (impatient threshold) without busy redraws.
- `styles.css`: blink and dizzy/tap keyframes, all off under reduced motion.
- `screens.js`: Settings "Serious mode" switch.

## Main process
- `src/shared/credits.ts` `AppSettings.seriousMode?: boolean` (parse: only `true` is kept), `SettingsStore.setSeriousMode`, IPC `settings:setSeriousMode`, `settings:get` returns it; preload and `api.ts`; simulator bridge in memory.

## Simulator
- Context bands: give two agents context in the heavy band and one in the monster band; one agent with three failed calls in a row; `simwaitold=1` backdates waiting permission requests by 2 minutes.

## Tests and checks
- `scripts/test-mood.ts` in `npm test`; `scripts/test-credits.ts` for `seriousMode` (round trip, keeps cap and place map).
- `npm run check:office` must stay 105/105 (no layout change); driver `scripts/shots-034.js` checks each state and Serious mode at both sizes and takes the screenshots.

## Risks
- Art quality ("no AI-slop art"): reuse the existing shapes and palette of `scene()`, small additions only, review the screenshots closely.
- Scene cache growth: key adds two small enums, bounded.
- Merge with spec 033 (floors) in `app.js`: keep changes local to `scene()`, card text and event hooks.

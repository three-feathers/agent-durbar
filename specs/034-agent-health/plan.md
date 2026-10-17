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

## Implementation notes (phase 2, 2026-10-17)
- Built as planned: `mood.js` (rules and tracker, `test:mood`), `seriousMode` in the settings file (parse keeps only `true`, store, IPC, preload, api, simulator bridge; tests in `test:credits`), the drawings in `scene()` (heavy body, monster, ambulance, faint, dizzy, impatient), accessible words on the card, Settings switch, simulator support.
- Found while building: a **pending permission request arrives inside a `status` event** (`needs-permission` with a `permission`), in the real Copilot adapter too, and only its answer comes as a `permission` event. The first version of the hook listened only to `permission` events, so "impatient" could never have started; `onLiveEvent` now feeds the tracker from both.
- The monster is drawn by overriding the figure's skin colour and adding horns, hair tufts, angry brows and a frown to the same head; heavy and monster widen the torso (x 52..96, still inside the chair); the ambulance sits at x 18..54 of the scene (the compact viewBox starts at x 16), in front of the desk's left end.
- The helper constant is `MOODS` (spec 030's model code already uses `DM` in `app.js`).
- Simulator already had a monster (Noor 91%), a heavy agent (Elif 86%), an error (Tomas) and a limit (Omar); added: Sven has three failed calls in a row, `simwaitold=1` backdates pending requests by 2 minutes.
- Checks run: `npm run typecheck && npm run build && npm test` (26 groups), `npm run check:office` 105/105 (no layout change). Seen once on the simulator at 1440x900. The driver, close-up screenshots, Serious mode and the review are phase 3.

## Verification (phase 3, 2026-10-17)
- Driver `scripts/shots-034.js` (both sizes, Serious mode, reduced motion, `mini`), screenshots `docs/screenshots/034-*`, mutation check, review fixes and known gaps: see the spec's *Verification* section.

## Plan for the 2026-10-17 delta: rooms darken, sirens (issue #135)

- Constitution: I spec delta, plan and tasks before code; II renderer only, reads the moods already computed; III nothing new on disk (Serious mode is the existing switch); IV simulator and unit tests, 0 AIU; V calm: tones stay light, contrast checked, one small siren, reduced motion, Serious mode, no layout change; VI no platform code; VIII limits in the spec.
- `mood.js`: `roomAlertOf(moods)` next to `troubleOf`, pure, unit-tested.
- `app.js`: `roomAlert(r)` = `roomAlertOf` over `moodFor(a)` of the room's live main agents (and returns calm at once in Serious mode: the Error state counts for `alarm` and is not cleared by `moodFor`, found in analyze); `roomHTML` adds `data-alert` and the siren to the header; `plateHTML` adds the siren; both `aria-label`s add the words. The 5 s mood timer's signature already changes when a mood changes, so tones follow without a new timer.
- `styles.css`: per room colour two darker steps for `--tint` and `--wall` (compact and full densities), `.siren` with a red/blue blink, off under reduced motion; colours picked so the header's grey path text keeps 4.5:1.
- `sim.ts`: one room (likely `infra-notes`) gets an agent at about 78% context, so a room is `uneasy` only.
- Driver: extend `scripts/shots-034.js` (tones per room from `data-alert`, the siren moving with the ambulance, closed plate, Serious mode, reduced motion, contrast computed from computed styles, floor off with `simfloors=1`).
- Risks: darker rooms vs. calm UI (keep the steps small, review screenshots); the siren takes ~14 px of the room header, so long room names may cut earlier (check at both sizes); overlap with spec 033 floor tags in the header.

### Implementation notes for the delta (phase 2, 2026-10-17)
- Built as planned: `roomAlertOf` in `mood.js` (unit-tested in `test:mood`), `roomAlert(r)` in `app.js` (calm at once in Serious mode; counts only live main agents, like `moodFor`), `data-alert="uneasy|alarm"` and `data-siren` on the open room, the siren (`.siren`, 18 px beacon, red/blue blink) after the room name and on door plates, `Alert: an agent needs help` appended to the room's and the plate's `aria-label`. The existing attribute sync in the morph code adds and removes `data-alert` without a redraw of the cards.
- Darkening is an inset box-shadow over the floor (`rgba(40,26,14)` at .045 for uneasy, .10 for alarm) plus a darker wall colour (`color-mix` with the room's own `--wall`), so cards, text and sizes do not change and each room keeps its colour. Rules sit at the end of `styles.css` with `.stage .room[...]` so they beat both density rules.
- Simulator: Maya (a done agent: idle agents report no context) starts at 73% of a 128k window, below the auto-compact line, so `infra-notes` is uneasy while `blog` stays calm; the other rooms are alarm (monster, error, faint).
- Found: the first try used Hugo, but an idle agent never reports its context (usage runs only when an agent works), so his room stayed calm.
- Checks run: `npm run typecheck`, `test:mood`; seen on the simulator at 1440x900. The driver extension (tones, siren moving with the ambulance, plate, Serious mode, reduced motion, contrast, floor off), screenshots, README, CHANGELOG and the review are phase 3.

### Verification for the delta (phase 3, 2026-10-17)
- See the delta's *Verification* in the spec: driver checks, measured contrast, review fixes (plate size, full-density ring, header text colour) and the calm-room contrast gap (T015).


# Implementation Plan (as built): Office view, densities, list view and filters

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered from `src/renderer/*`, README, screenshots

## Summary

The office is rendered by plain, framework-free JavaScript in the sandboxed renderer. Agents (real, simulated or demo) are plain objects;
`renderOffice()` groups them into rooms, asks `chooseLayout()` for the richest density that fits, builds HTML strings and **morphs** them into the live DOM by key.

## Technical Context

- **Language**: JavaScript (renderer, no modules, one IIFE in `app.js`), TypeScript for `renderer.ts` and `sim.ts` (compiled to plain scripts), CSS.
- **Dependencies**: none in the renderer. `demo.js` holds sample data and avatar looks.
- **Storage**: none (state is in memory; folder list persistence is feature 006).
- **Testing**: none automated for layout. Manual: screenshots (`DURBAR_SHOT`) and driver scripts under xvfb; see [quickstart.md](quickstart.md).
- **Target**: Chromium in Electron 44 (all three OSes).
- **Constraints**: text >= 10.5px; 15 agents on 1440x900 and 1280x800; no page scroll.

## Constitution Check

| Principle | Result |
| --- | --- |
| I Spec Kit | Spec reverse-engineered; future changes need delta/new spec. OK |
| II Adapters | Renderer consumes normalized events only. OK |
| III Safe by default | n/a (no capability); CSP `default-src 'none'; script-src 'self'`. OK |
| IV No credits | Verified entirely on the simulator. OK |
| V Calm UI | Core of this feature. Gap: not automated (FR-015). **Partial** |
| VI Parity | Chromium rendering is the same engine on all OSes; not verified by hand off Linux. **Partial** |
| VII Gates | Screenshots exist (`docs/screenshots/m2..m5-*`); no automated layout test. **Partial** |
| VIII Honest limits | README lists remaining items. OK |

## As-built architecture

```text
src/renderer/
├── index.html      shell: top bar, #floor > #stage (visible) + #probe (hidden, for trial layouts), #list, #panel (feature 005)
├── styles.css      tokens, densities via .stage[data-d=full|roomy|card|mini|micro], animations, reduced-motion block
├── app.js          state (agents, ROOMS, ui), chooseLayout(), roomHTML/unitHTML/cardHTML/helperHTML, morphHTML (keyed patching), list view, stats
├── demo.js         sample data + avatar looks (window.DURBAR_DEMO)
├── sim.ts          simulator (feature 010)
└── renderer.ts     tiny entry
```

Key mechanisms (all in `app.js`):

- **Densities** (`DENS`): `full` (cap 3 helpers beside the parent), `roomy` (cw 262), `card` (236), `mini` (216), `micro` (190). `CANDIDATES` order: full3, roomy3, card3, card1, mini3, mini1, micro3, micro1.
- **`chooseLayout(sizing, aw, ah)`**: for each candidate, renders into `#probe` and tests `scrollHeight/scrollWidth` against the floor; for compact densities it tries column counts from max down and prefers desks close to 1.3x the density's base width. With 1 helper per strip it then boosts agents with the most helpers to 3 while it still fits. Result cached under a key of floor size, forced density, and the office *shape* (rooms, agents, helper counts, expanded flags).
- **`morphHTML`**: converts the new HTML to a template and patches the DOM by `data-key`/`data-id`, so a status tick touches only changed nodes.
- **Sorting**: `prio()` = waiting 0, error 1, else 2; room mains sorted by the best priority among agent and helpers.
- **Status vocabulary**: `working|thinking|waiting|idle|error|done`; `Paused` is a UI-only state of demo agents.
- **Floor overflow**: if no candidate fits, `layout.fit=false` and `#floor.scrolls` makes the *floor* scroll.

## Project Structure (documentation)

```text
specs/001-office-view-and-densities/
├── spec.md
├── plan.md
├── quickstart.md   how to re-run the measurements
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Build, typecheck, tests pass | `npm run typecheck && npm run build && npm test` | pass, 2026-10-16 |
| SIM=15 @1440x900 closed: `roomy`, no overflow, min font 11px | xvfb + Electron driver (quickstart.md) | pass, 2026-10-16 |
| SIM=15 @1280x800 closed: no overflow, min font 10.5px | same | pass, density `mini` (README table says `card`: FR-016) |
| SIM=12 both sizes: `roomy` | same | pass |
| No overlap / clipping / floor overflow: SIM=12 and 15 x 1440x900 and 1280x800 x 0,1,2,3,4,all rooms closed, `?closed=` by name, Close all/Open all, expanded `+N more` | `npm run check:office` | pass, 95/95, 2026-10-16 (fails on the pre-fix code) |
| Chat open at both sizes: no page overflow, no horizontal overflow in `#chat`, strip has all agents | same | pass |
| Chat open densities (README: `card` at 1440x900, `mini` at 1280x800) | README only | not re-run |
| Keyed updates keep animations | README measurement | not re-run |
| macOS and Windows rendering | none | untested |
| Layout search speed and same layout (FR-033, SC-004) | instrumented simulator build, alternating with `main`; 54-case layout and box comparison | pass, 2026-10-21: floor switch 438-526 ms -> 134-146 ms, `chooseLayout` 388-480 -> 97-105 ms (Linux, 4 cores, Xvfb); macOS and Windows not timed |

## Delta 2026-10-22 (owner decisions on #532): columns on a wide grown desk (FR-047..FR-050)

- **Reuse.** The grown card from `cardHTML` (one more `<span class="gx">` only while `GROW`), `grownLine` for the main column, `DurbarLiveAct.excerpt` for the reply column, `fitLines` for whole lines, `usageLong`, `DurbarScreens.ctxChip`, `ACT.agoLong`, the readout's tool phrase. No new module, no new layout search.
- **Pure helper** in `src/renderer/probe.js`: `GCOL` (main 260-450 px, 360-450 beside two others, reply 240-420 px, facts 180-320 px, gap 16 px) and `grownCols(room, {reply})` -> `{n, main, reply, side}` (n = 1, 2 or 3; widths never above the maxima; 0 for a column not shown). `test:probe` covers it.
- **Render.** After `renderOffice` (where `fitLines` already runs), for each grown card: measure its width, `grownCols`, set `data-gc` and `--gm`/`--gr`/`--gs` on the card, then `fitLines` on the stream and the reply. The card's `max-width` is the sum of its columns, so a wide room does not stretch the lines. The probe never sets `data-gc` (the height does not depend on it).
- **Data.** `liveact.js` keeps the last tool phrase of the turn (`tool`, cleared with the readout at the turn's end) and `of()` returns it; `setState` sets `a.busySince` when an agent turns busy and clears it when it is Done or Idle; the 30 s tick includes it.
- **CSS.** `.stage[data-d="roomy"][data-grow]`: `--cmax` 1600 px; `.desk.card[data-gc]` grid columns `var(--sw) var(--gm) [var(--gr)] [var(--gs)]`; `.gx` hidden without `data-gc` and in the probe; `data-gc="2"` stacks reply over facts; facts one line each with an ellipsis. Theme tokens only, no font-size under 10.5 px, no transition.
- **Checks.** `test:probe` (`grownCols`), `test:liveact` (`tool`), `check:office-fill` (1 and 2 agents at 1440x900, 1280x800, 1920x1080: `data-gc` >= 2, characters per line <= 90 measured per line, page rules); screenshots `001-fill-{1,4,6}-1440x900.png`, `001-fill-1-1920x1080.png`.

## Delta 2026-10-22: finished agents roll in (FR-051..FR-057)

- **Reuse.** `officeModel` splits each room's main agents into open desks (`mains`) and rolled ones (`rolled`), so `chooseLayout`, `growSearch`, `roomHTML`'s column count and the layout key see only open desks; nothing else in the layout search changes. Time: `a.lastEventAt` (`sinceLast`), worded by `DurbarActivity.agoLong`, repainted by the existing 30 s tick (which already re-renders when a minute label changes). Reply line: `DurbarLiveAct.excerpt` + `DurbarRedact.redact` (fail closed, like `grownLine`). Old chips beyond the cap: the helper strip's `.more` button with `data-more="shut:<room>"` and `ui.expanded`, so the existing click handler and focus restore work. Strips and chips are `button.desk.shut[data-id]`: the existing `[data-id]` click (open chat), `DESK_NAV` arrow keys, the context menu and `check:office`'s overlap and inside-the-room rules apply to them unchanged.
- **New pure module** `src/renderer/shutters.js` (UMD like `activity.js`): `RECENT_MS` (10 min), `OLD_CAP` (4), `finished(x)`, `kindOf(x, sinceMs)` (`'recent' | 'old' | null`), `roomPlan(list)` (the room rule; returns `id -> kind`) and `split(oldList, cap, expanded)`. Inputs are plain objects (`{id, state, paused, limit, away, replied, helpersBusy, since}`), so `scripts/test-shutters.ts` runs it in Node. Listed in `copy-assets.js` and `index.html`.
- **Render** (amended 2026-10-22 19:55, the lounge). With resting agents, a compact room's `.units` becomes a flex row: the desk grid (`.units-in`, the old grid rules and `--cols`) and, at its end, the `.lounge` corner (`data-key="shut:<room>"`) with its width from `DurbarShutters.width()`, one desk high (`--ch`, times `--gf` when grown). `roomHTML` adds that width to the room's `--w` and `--min`, so the search measures it; in `full` it is one more flex item. Inside: a bubble band (a speech bubble over the couch, a dream cloud over the beds; each holds every resident's line and shows the one `DurbarShutters.turn(TURN, n)` picks) and the furniture band: couches (inline SVG filled with theme tokens) with seat buttons, and bed buttons (bed SVG), each with the agent's `avatar(a)` (the theme's scene kit), lying for the beds. A page timer moves `TURN` every 7 s and only toggles classes (no re-render); the frozen simulator has no timer and a driver calls `__durbarSimUi.loungeTurn()`. Each character carries a hidden `.peek` card opened beside the lounge on `:hover` / `:focus-visible` (a measured `pk-right` class). A `rolling` class marks a new arrival (one settle-in); `@media (prefers-reduced-motion)` turns animations and the fade off.
- **Layout key.** Adds each room's rolled ids with their size and the chips' `+N` state, so a desk that rolls in (or a strip that becomes a chip) re-runs the search; status changes inside the same size still only patch the DOM.
- **Setting.** `durbar.shutters` in `localStorage` (`on` by default), a switch in `screens.js` next to *Live activity on desks*, passed through `DurbarScreens.init` like `liveAct`.
- **Simulator.** `window.__durbarSimUi` (simulator only) gains `render()`, so a driver can set an agent's `lastEventAt` back in time and re-render; no new simulator query.
- **Risks.** The time is the last event's arrival, not a vendor timestamp: an event after the turn (a late usage or title) restarts the 10 minutes; that only keeps a strip half rolled a little longer. With a status filter the rolled agents of the shown status stay rolled (the shape does not change when a filter is chosen, as before).

## Delta 2026-10-22: grown desks when there are few agents (FR-041..FR-046)

- **Reuse.** `chooseLayout` and `probeSet` (one probe, the same fit test), the `roomy` card from `cardHTML`, its column search and grid (`--cols`, `--cmax`), the readout from `liveact.js` (`of(id)`), `paintLive`, `fitSide` (bottom-anchored text with a top fade, from the side panel), `fitUsage`. No new layout system: a grown desk is a `roomy` card with one more custom property.
- **Pure helpers in the existing `src/renderer/probe.js`** (the layout search's trial helpers, FR-033; no new module): `GROW` constants (min 1.0, max 2.5, step 0.1, two-line title from 1.4), `largest(fits, lo, hi, step)` (binary search over the steps of a monotone fit test), `better(a, b)` (larger *f*, then more of the floor's height, then fewer columns) and `pick(cols, lo, trial)` that runs both over the column counts. `scripts/test-probe.ts` (`npm run test:probe`) tests them with synthetic fit tests and a simple box model of rooms.
- **Layout.** After the candidate loop, when the result is `full` or `roomy` and no density is forced, `growSearch` sets `GROW` (the HTML of a grown card) and, per column count, puts the stage HTML in the probe once (`probeSet`, so column changes are set in place) and then only changes `--gf` and `data-grow` on the probe for each *f*. The layout result gains `grow` (*f*, or 0); `renderOffice` sets `--gf` and `data-grow` (`1`, or `2` from *f* 1.4) on the stage. The layout key is unchanged: *f* follows from the same inputs.
- **CSS** (`styles.css`, theme tokens only): `.stage[data-d="roomy"][data-grow]` scales `--cmax`, `--sw` and the card height by `--gf`; the text line becomes a flex column that fills the card (max 8 lines), `.over` anchors it at the bottom with the side panel's fade; `data-grow="2"` lets the name wrap to two lines.
- **Text.** `liveact.js` keeps a third, longer form of the readout (`long`, 600 characters, the newest sentences). `deskLine(a)` in grown mode returns the kind word and `long`, or for Done/Idle the start of `a.lastOutput` (plain words from `DurbarLiveAct.plain`, masked by `DurbarRedact.redact`, cut with `DurbarCutText`), or `taskOf(a)`.
- **Simulator.** `sim.ts` reads `simrooms=<1..5>` (agents in that many folders, in blocks) and `simhelpers=0` (no helpers) from the page address itself, like `simkinds`, so the option list in `app.js` is unchanged.
- **Checks.** `scripts/check-office-fill.js` (driver; `npm run check:office-fill`, listed in `scripts/ui-suite.js`); `check:office`, `check:geometry`, `shots-001-live-activity` (its sparse part now forces `full` to keep checking the side panel, and checks the grown desk instead in the default layout).
- **Risks.** Theme fonts: the fit is measured per theme, so a theme whose header is a fraction of a pixel taller could pick a different *f*; `check:geometry` runs with 12 and 15 agents, where 12 can grow, and catches it. Cost: up to about 5 trials per column count when few agents are on the floor (cheap: few elements); none at 15 agents.
- **Review of #532 (T093-T096).** `liveact.js` `excerpt(raw, redact)`: `plain(redact(raw))`, '' without a working mask; `grownLine` cuts it to 600 or shows `Finished.`/`Ready.` (never `taskOf`, which for a Done agent is the unmasked reply until #541 lands). `long` is no longer computed per delta: the model keeps the masked `body` and `of()` returns `long` as a getter that computes and caches it; a body change counts as a change only once a grown desk has read `long`. `chooseLayout` sets `GROW=0` first. The `redact.ts` underscore fix (spec 012 FR-080 delta) is PR #543's, not this PR's (T094). #541's `safetext.js` and `excerpt` become one helper (T097).

## Delta 2026-10-21: live activity on the desks (FR-028..FR-032)

- **Reuse.** Events: the normalized `thinking`, `output` and `toolCall` events already reaching `onLiveEvent` in `src/renderer/app.js` (no adapter or `src/shared` type change). Desk text: the existing `.task` (`full`) and `.intent` (cards) line from `taskOf(a)`. Tool words: `toolKind`, `toolLabel` and, in Simple, `plainChip` (spec 052 FR-081). Cutting: `DurbarCutText.cutText`. Masking: `src/shared/redact.ts` (`redact`, `maskSecretCommand`, `maskSecretUrl`), loaded in the page as the compiled `dist/shared/redact.js` behind a two-line `exports` shim (`src/renderer/exports-shim.js`), because the module has no imports. Setting: the Spacing pattern (`localStorage`, Settings > General).
- **New pure module** `src/renderer/liveact.js` (UMD like `cuttext.js`): `create()` keeps per agent `{kind, text, lines}` from events; `phrase()` builds tool phrases; `lastSentences()` picks the newest whole sentences; masking is injected (`{redact, cmd, url}`), so `scripts/test-liveact.ts` runs it in Node with the real `redact.ts`. A per-agent throttle (`due(id, now)`) allows one paint per 250 ms; a trailing timer paints the last text.
- **Layout.** `CANDIDATES` gains `['full',3,'side']` and `['full',2,'side']` before the plain `full` ones; `LIVE_SIDE` is set while a candidate is probed, `unitHTML` adds a fixed `.liveside` box after the desk (before helpers) and `unitWidth` counts it, so the existing fit check (`chooseLayout`) decides. The layout key includes the setting.
- **Paint.** The stage HTML renders the readout from the model; between renders `paintLive(a)` sets `textContent` of `[data-live="<id>"]` nodes only (no `scheduleRender`, no layout change).
- **Risks.** Thinking text can be long and fast: the model keeps only the last 1200 characters of a block. A secret in reasoning text is masked by `redact` patterns only (env values are unknown in the page): `[KNOWN GAP]` same as the chat, which shows that text unmasked today.

## Delta 2026-10-22: Boss, Bank, Postbox in the lobby; who is at a place; room header words (FR-034..FR-040)

The first build of this delta (a right-side rail with Needs you, Scheduled and a legend, folded to a strip) is removed by the owner's decision of 2026-10-22 06:53 Zurich; what it built for the lobby entries (FR-036) and the header words (FR-037) stays.

- **Reuse, no parallel systems.** Places: `lobbyPlaces`, `lobbyHTML`, `placeVisitors`, `VISITS.pin/unpin/at` (spec 068), `syncWalkers` + `RETURNING` (the walk to a `.slot` and back; reduced motion = no walk), `openPlaceMenu` (+N, the shared `#modeMenu`). Requests: `pendingCardOf`, `needsMeOrder` / `NEED_SINCE` (order and wait), `ATT.waitLabel`, `openPanel`. Limit: `startCoffee` with kind `cap` (spec 068), `showLimit` / `settleLimit` (spec 011). Schedules: `SCHED`, `recurringS`, `clock`, `bridge.onScheduleRan`, `openSchedSettings` (Settings > Schedules). Words: `wordOf`, `CLEAN_WORDS`, per-theme `words`, `GEN_WORDS`.
- **places.js.** New special ids `BOSS='boss'`, `BANK='bank'`, `POSTBOX='postbox'` next to `COFFEE` (never mapping choices, reserved names like "Coffee corner"); `lobbyFit(aw, places, addButton, post)` -> `{boss, coffee, bank, post: {width, named, chips}, tile, caps}` (FR-039; replaces `coffeeTile`); `lobbyOrder(ids)` puts the Boss at the middle index; `postNext(schedules, pausedAll)` and `lettersToday(schedules, pausedAll, now)` (pure). `test:places` covers them.
- **Boss (app.js).** `syncDesks()` at the start of `renderAll`: for each live main agent, a pending question/permission card -> `VISITS.pin(id, BOSS, kind)`; a Boss visit without one -> `unpin`. Entries at the Boss are buttons (`data-pvopen`), sorted by `NEED_SINCE`; the badge is a small span on the entry's slot (`?` or a key SVG). `openAtRequest(id)` = `openPanel` then the pending card into view and focus. `taskOf` gives "Went to see the boss · <request>" while away at the Boss.
- **Bank.** `startCoffee` pins kind `cap` to `BANK` with the label *Limit reached*; `moodFor` keeps the calm look but no cup for a cap; the inbox and chat words for a cap say "reached its spending limit". Entries at the Bank are buttons too (open the chat at the limit card).
- **Postbox.** A `<button class="place postbox">` tile: header (icon, name, "N today", flag) left, three lines right. `bridge.onScheduleRan` -> `flyLetter(agentId)`: one absolutely positioned element in `#walkers` from the Postbox to the desk, CSS transform transition, removed on `transitionend` (fallback timer); skipped under reduced motion.
- **Removed.** `#rail` in `index.html`, `renderRail`/`railHTML`/`railSchedules`, rail CSS, the rail/strip layout search in `renderOffice` (back to one `chooseLayout`), the room-name fold, `check:office` rail rules, `scripts/shots-001-rail.js` and its screenshots.
- **Simulator.** `simsched=1` seeds three schedules (one with a missed last run); the driver fires one through the simulator bridge's existing `ran` hook.
- **Risks.** Up to 9-12 lobby tiles: the fit rule keeps them in one row; at 1280x800 with 8 places the other tiles get one entry and "+N" (accepted, checked). Agents at the Boss leave their desks: `check:office`'s "empty chair" rule needs the Boss in the lobby labels (it is).

### Review on #511 (Paco's agent, 2026-10-22 23:45 UTC)

- **Escaping.** No code change for (1): the lobby already escapes; `shots-001-lobby.js` gains a hostile-title pass (title events with markup for agents at the Boss, one of them in "+N", the Bank and the coffee corner; a schedule prompt with markup through the simulator bridge's `saveSchedule`). Mutation: drop `esc(a.name)` in the entry.
- **#560 rule.** `postMissed` keeps its own filter, with the one-time test `every === undefined && !rule` (same as #560's `!recurring`). Hand-off: whichever of #511 and #560 lands second replaces the filter with `DurbarSchedTop.missedOrFailed` and moves the Postbox to #560's Schedules entry point. `test:places` pins `every: null` (done, missed: counted as repeating, so not counted).
- **Mask before cut (spec 041 FR-065).** `deskTip(a)` = `DurbarRedact.redact(full text)` then `cutText(…, 200)`; the accessible name's task text goes through the same redact. No redact module: name only. Hand-off with #567: whichever lands second switches these and `PLACE_DOING` to `DurbarSafeText` and runs `check:done-desk-mask` with the lobby on screen. Check: the driver puts a `ghp_` token across the 200th character of a desk title and asserts no `ghp_` and no piece of it.
- **Reuse.** `focusRequest(card)`, shared by the answer bar's `show` and `openAtRequest`.

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

## Delta 2026-10-23: linked screenshots in one command (FR-082..FR-084)

- **Reuse.** The pictures are taken by the existing drivers (`shots-hero`, `shots-001-lobby`, `check-office-fill`, `shots-052-ux`, `shots-themes`, ...); the runner is spec 008's `ui-suite.js` `runOne`, exported with two small options: `freeze: false` for drivers that run a live simulator (`shots-001-live-activity`, `shots-012-cost-cap`), and the output variables `HERO_OUT` and `SHOTS_DIR` added to the shared list. `shots-006-home` writes to `OUT` when it is set (it wrote only into `docs/screenshots`).
- **New file** `scripts/shots-docs.js`: `linkedImages()` (README `docs/screenshots/*.png`, gallery `file`, landing `*.png`), `DOC_SHOTS` (driver, env, files; a file may come from another name, e.g. `shots-themes` writes `site-theme-clean-office-1440x900.png`, the landing page links `site-theme-clean-1440x900.png`), `NO_DRIVER` (reason per file), `coverage()` for the test, `main()` (serial by default, temp folder, copy, fail on a missing file).
- **Test.** `test-ui-suite.ts`: `coverage()` is empty both ways (every linked image covered, every covered entry linked or kept on purpose), every listed driver exists, and the runner has no shell.
- **Risks.** A driver that asserts may fail on a changed screen: then the PR that changed the screen fixes the driver (that is the point). Screenshots differ by font between machines; they are taken on Linux under Xvfb like the earlier ones.
- **Pinned clock (FR-084).** Tried first: `webContents.debugger` with `Emulation.setTimezoneOverride` and `Page.addScriptToEvaluateOnNewDocument` before the first load; a DevTools command sent before the window's first navigation never answered (Electron 44, `sim:`), and loading `about:blank` first would fire `did-finish-load` for the wrong page (the driver hook). So: main sets `TZ=UTC` and `--lang=en-US` before `ready` and passes `simclock=<ms>` in the page query (simulator only); `simclock.js`, the page's first script, replaces `Date` with a subclass whose `now()` and argument-less constructor are shifted (a `Proxy` keeps `Date()` without `new` returning text).

## Delta 2026-10-23: spare height grows the rooms, then even gaps (FR-086..FR-088, issue #619)

- **Pure helper** `DurbarProbe.spreadRows(lines, avail, gap, cap)` in `src/renderer/probe.js`: `lines` are the stage's rows (`{h, room}`), `avail` the floor's inner height, `gap` the row gap (10 px), `cap` the share a room row may grow (0.2). Returns `{rx, top, rowGap}`: `rx` the extra height of every room row (the spare split over the room rows, at most `cap` x the shortest), then `top` and `rowGap` so that the gap above the first row, between rows and below the last are even (`rowGap` never below `gap`; when it would be, the rest is split above and below). Nothing (`rx` 0, `top` 0, `rowGap` = `gap`) when nothing is spare.
- **Page** (`app.js` `spreadOffice(stage)`, called by `renderOffice` after drawing, only when the layout fits): clears the stage's `--rx`, `padding-top` and `row-gap`, groups the stage's children into rows by their top, calls `spreadRows`, and sets them on the stage (`data-spread`). CSS (`styles.css`): `.stage[data-spread]` adds `calc(var(--rx)/2)` below a room's header and below its desks (`.room-head`, `.units` margins), so the header stays at the top and the desks sit in the middle; `row-gap` on the stage gives the even gaps. The probe (layout search) never has `data-spread`, so what it measures is unchanged.
- **Risk.** The lobby's walking figures are placed from measured slot positions; the spread is set inside `renderOffice` before the figures are synced, as the rest of the drawing. `check:office`, `check:geometry` and `check:office-fill` run unchanged.
- **Test first.** The `check:office-fill` case and the `test:probe` cases are added before the page code; the driver case fails on `main`.


## Delta 2026-10-25: expanded helper cards when the office has room (FR-089..FR-097, issue #697)

Started from scratch on the owner's decision (Vikram, 2026-10-25); nothing from the earlier `001-helper-activity` attempt is reused (that branch exists neither on `origin` nor locally).

### Reuse (existing code paths; no parallel system)

| Need | Existing code | How it is used |
|---|---|---|
| Helper data (task, prompt, status, result, own final reply, error, duration, tool calls, tokens, model) | `subRec`, `onSubagent`, `onTaskTool`, `onSubEvent` in `app.js` (the record on `card.sub`); `subFoot`, `subStatusText` | read only; the expanded card is a third view of the same record, after the chat block (`subBlock`) and the Sub-agent activity view (`buildSubTranscript`) |
| Current activity | `onSubEvent` (today it keeps only the `toolTask` string on the card's `task` line); it also stores `s.now` = `{kind, tool, label}` for a tool start, `{kind:'intent', text}`, `{kind:'thinking'}` (raw; masked at display through `safeToolLabel` / `safeExcerpt`) | shown as **Now:**; in Simple, the plain words of `plainChip` (spec 052 FR-081) instead of `toolTask`'s tool name and argument |
| Masking and cutting | `DurbarSafeText` via `safeExcerpt`, `safeMask`, `safeToolLabel`; `DurbarCutText` (`SHORT`); `src/shared/redact.ts` in the page (`DurbarRedact`) | injected into the pure module (below); the same fail-closed wrapper (`SAFE`) |
| Compact tile, strip, grouping | `helperTileHTML` (level 0, unchanged); `helperHTML` (the `full` density's 90 px card beside the desk) is **not** extended: expanded cards only appear in a grown `roomy` strip under the desk, and `full` keeps its beside-the-desk helpers unchanged; the new card reuses its pieces (`scene`, `badgeSVG`, the `aria-label` pattern); `unitHTML` `.helpers.hstrip` with its connectors, `visibleHelpers` + `prio`, `moreHTML`, *Show fewer* | the strip gets `data-hx` and the cards a level; level 0 renders byte-for-byte as today |
| Layout | `chooseLayout`, `probeSet`, `growSearch`, `DurbarProbe.pick`, `GR`, the helper boost (`HBOOST`), the layout key, `spreadOffice`, `headsFit` | one more step inside `chooseLayout`; one more field in the result (`hx`); the theme id added to the key |
| Open, keys, names | the `[data-id]` click → `openPanel` → `buildSubTranscript`; `DESK_NAV`; the helper `aria-label` pattern | unchanged selectors, so `check:office` and the arrow-key code apply as they are |
| Setting | *Live activity on desks* (`liveOn()`, FR-032) | governs the **Now:** line only (owner decision 3, 2026-10-25) |
| Simulator | `subRun` in `sim.ts` (task, activity, result, failure, `simreply=secrets` plants), `simrooms`, `simhelpers=0` | `simhelpers=<1..6>` and one Codex-shaped helper |
| Checks | `check-office-fill.js` (sparse offices, page rules), `check-office-overlap.js`, `check-theme-geometry.js`, `check-done-desk-mask.js`, `test-probe.ts`, `test-safetext.ts`, `driver-helpers.js` (`until`, `openSimAgent`, `shot`), `shots-docs.js` | new cases in the existing drivers; no new driver |

**New:** one pure UMD module `src/renderer/helpercard.js` (like `shutters.js`), because `app.js` is one IIFE and the field rules must be unit-tested in Node with the real masking:
- `HX` constants: level heights and minimum widths (level 1: name line + 1 text line; level 2: name line + 2 + 2 + 1 lines; minimum widths about 220 and 260 px, maximum 460 px for the ~85-character measure), `HX_MIN_F` (1.4, owner decision 1).
- `lines(rec, level, {simple, live, mask, cut})` → `[{label, text, reported}]`: picks **Task**, **Now** / **Result** / **Failed**, facts; *not reported* when a field is absent; never substitutes one field for another; with no working `mask` only Durbar's own words (fail closed).
- `HX_CHARS` (240): the one per-field cap; `lines` cuts every agent-written field with `safeExcerpt(text, HX_CHARS)` after masking, and the text, `title` and `aria-label` all use that cut value (review on #714).
- `memo()`: a per-helper cache keyed by field and raw value, so `lines` masks a field once per change and a repaint with unchanged fields calls no mask (review on #714).
- `HX_TIP` (200): the tooltip cut, the number `deskTip` uses (`app.js`; `cuttext.js` has no shared tooltip constant).
- `label(rec, parts)` → the accessible name text (each part the `HX_CHARS` cut, already masked) and `tip(...)` cut to `HX_TIP`.
Listed in `copy-assets.js` and `index.html` like `shutters.js`.

**In the existing `src/renderer/probe.js`** (the layout's pure helpers): `stepRuns({d, forced, fit, helpers})` → true only for `full` / `roomy`, not forced, fitting, with at least one helper on an open main: the gate of the helper step, pure so `test:probe` can catch "a dense density runs the step" (15 simulated agents never fit grown `roomy`, so a driver could not).

### Layout algorithm (in `chooseLayout`)

```text
res = existing candidate loop                      # unchanged (FR-002, FR-022, FR-029)
if DurbarProbe.stepRuns({d: res.d, forced: FORCE_DENSITY, fit: res.fit, helpers: some open main has helpers}):
    for L in (2, 1):                               # richest helper level first
        HX = L
        g = growSearch(sizing, aw, ah, openOnly, HX_MIN_F)   # same probe, same pick() tie rules
        if g: res = {d:'roomy', hcap:3, cap:g.c, fit:true, boost:[], grow:g.f, heads:res.heads, hx:L}; break
        # the same fields as today's grow result, plus hx: without hcap the boost is skipped and HCAP=undefined hides every helper behind "+N more"
if res.hx is unset:
    HX = 0; existing grow step from f 1.1          # today's path, box for box
boost (FR-009) with HX = res.hx                    # while it fits
probe cleared; HX = 0
```

- `HX` is a layout parameter like `HCAP`, `GROW` and `LIVE_SIDE`: set while a trial is probed and while the result is drawn; `chooseLayout` resets it first (the #532 lesson: a grown render left `GROW` on), and `renderOffice` restores it from `layout.hx` next to `HCAP=layout.hcap` and `GROW=layout.grow?1:0`, because a cached layout skips `chooseLayout` (without it, every render after the first would draw compact tiles).
- Fixed heights per level (`--hxh` by `data-hx` on the strip) make the fit independent of the text; the probe measures the strip's real height with the same CSS.
- Cost: at most two extra grown searches (about five trials per column count each), only with few agents and some helpers; none for 15 agents (they pick `card`, `mini` or `micro`). Budget: `chooseLayout` median at most 150 ms (SC-004's number) in both regression scenarios, measured with the instrumented-copy method in `docs/agent-notes.md`.
- The layout key gains `THEME.themeIdForCache()` (FR-092); `applyTheme` already calls `renderAll`, so a theme switch then searches again.

### Rendering

- `unitHTML`: when `HX>0` the compact branch emits `.helpers.hstrip[data-hx="L"]` with `helperCardHTML(h, L)` (the new card), else `helperTileHTML` as today. `full` keeps its beside-the-desk helpers (the helper step only yields grown `roomy`).
- `helperCardHTML`: `button.helper.hc.hx` with `data-id`, the scene, the status badge, the name and status line, then the labelled lines from `DurbarHelperCard.lines`; each line `-webkit-line-clamp`ed to its level's lines; a *not reported* line in `--muted` with the fixed tooltip.
- CSS (`styles.css`): `.helpers.hstrip[data-hx]` grid `repeat(auto-fill, minmax(var(--hxw), 1fr))` capped by `--hxmax`; `.helper.hc.hx` fixed `height: var(--hxh)`; theme tokens only; no font size under 10.5 px; no transition.
- Connectors: today's per-tile connectors assume two columns (`repeat(2,…)`, `:nth-child(2)`, `:nth-child(n+3)` in `styles.css`). On a `data-hx` strip the per-card connectors (`.helpers.hstrip>*::before`) are switched off; the strip keeps its stub and dot from the parent (`.helpers.hstrip::before`, `::after`) and gains one horizontal line along its top edge over the full strip width, so 1..N columns read as one group under the parent. Level 0 strips keep today's connectors exactly.
- Chat block: `subBlock`'s one-line summary (`.sub-task`: result, else last reply, else error, else task) stays as it is. It is a header line in the chat, with the labelled **Task** (prompt) and **Result** right below it in the same block, not a labelled result on the floor; FR-089's "never another field" rule is for the office cards. The compact tile (level 0) also keeps its tooltip and accessible name (the card's `task` line), unchanged.
- Chat routing (FR-095): in the parent's tool handler, `a.subs.has(e.callId)` is checked first and sends every phase to `onTaskTool`; `subRec`, when it creates a record whose call id already has a chip (`chipEls[id]`), removes that chip and clears the entry.

### Failure modes and what prevents them

| Failure | Prevention | Check |
|---|---|---|
| Text that streams changes a card's height and the office jumps | fixed height per level; whole-line clamps | `check:office-fill` streaming case compares every box before and after helper events |
| A huge tool result floods the DOM, `title` or `aria-label` | `HX_CHARS` cut after masking, used by all three | `test:helpercard` cap cases; mutation: raw length left in the `aria-label` |
| Masking on every repaint costs CPU | `memo()` per helper, field and value | `test:helpercard` mask-call count and CPU-time ratio; mutation: memo removed |
| A token shows on a card, in a `title` or `aria-label`, or half of one after a cut | one path, `DurbarSafeText` (mask, then plain, then cut); fail closed without redact | `check:done-desk-mask` sparse pass; `test:` `helpercard` with the real `redact.ts`; mutation: cut before mask |
| A task shown as the result (fabrication), or invented text | `lines` reads fields by name and writes *not reported* | `test:` `helpercard` (no result → *Result not reported*, never the task); mutation: fall back to the task |
| A cached layout from another theme overlaps | theme id in the layout key | `check:office-fill` switches the theme through Settings and re-checks the page rules; mutation: key without the theme |
| The 15-agent office changes | `card`/`mini`/`micro` never run the helper step (`stepRuns`) | `check:office`, `check:office-fill` 15-agent cases (densities named in T116), `check:geometry` |
| Expanded cards differ in another theme | the same CSS for all themes | `check:geometry` sparse scenario (Retro on PRs; all themes on `main`, nightly, `CHECK_ALL_THEMES=1`) |
| Desks shrink too far for helper detail | `HX_MIN_F` = 1.4 (owner decision 1, 2026-10-25) | `test:probe` order cases |
| A Claude helper never gets its result, and a stray chip stays | FR-095: routing by the record; the early chip removed when the record is created | T114 driver case with Claude-shaped events (`update` early start, start, `subagent` started, `complete`): result present, exactly zero tool chips for that call id |
| A cached render draws compact tiles | `HX` restored from `layout.hx` in `renderOffice` | T116 forces a second render with the same key (`__durbarSimUi.render` is a fresh search, so the case uses a status event) and expects `data-hx`; mutation: no restore |
| The helper step runs for a dense density | pure `stepRuns` gate | `test:probe`; mutation: `card` allowed |
| A helper that appears mid-turn | helper counts are already in the layout key | `check:office-fill`: a helper added after the first layout gets a card on the next search |
| Collision with #631 (cabins) | hand-off in the spec | whichever lands second re-runs `check:office-fill` |
| A driver flake on a slow runner | `until()` on conditions; reduced-motion run once | the driver passes with `--force-prefers-reduced-motion` |

### Constitution Check (this delta)

| Principle | Result |
|---|---|
| I Spec Kit | spec delta, plan and tasks before any `src/` change. OK |
| II Adapters | renderer only; reads normalized events already sent; no vendor names in the renderer (FR-095 keys on the `subagent` record, not on Claude's tool name). OK |
| III Safe by default | display only; masked before cut on every surface; fail closed. OK |
| IV No credits | simulator and unit tests only. OK |
| V Calm UI | 10.5 px, fixed heights, no animation, 15 agents unchanged. OK |
| VI Parity | renderer CSS and JS only; fonts differ per OS, the fit is measured in the page. macOS and Windows not run by hand |
| VII Gates | `npm run typecheck && npm run build && npm test`, the drivers above, screenshots through `npm run shots:docs`. OK |
| VIII Honest limits | per-app table with `real:` / `read:`; Codex result and Claude result order as `[KNOWN GAP]`. OK |

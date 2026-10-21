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

## Delta 2026-10-21: live activity on the desks (FR-028..FR-032)

- **Reuse.** Events: the normalized `thinking`, `output` and `toolCall` events already reaching `onLiveEvent` in `src/renderer/app.js` (no adapter or `src/shared` type change). Desk text: the existing `.task` (`full`) and `.intent` (cards) line from `taskOf(a)`. Tool words: `toolKind`, `toolLabel` and, in Simple, `plainChip` (spec 052 FR-081). Cutting: `DurbarCutText.cutText`. Masking: `src/shared/redact.ts` (`redact`, `maskSecretCommand`, `maskSecretUrl`), loaded in the page as the compiled `dist/shared/redact.js` behind a two-line `exports` shim (`src/renderer/exports-shim.js`), because the module has no imports. Setting: the Spacing pattern (`localStorage`, Settings > General).
- **New pure module** `src/renderer/liveact.js` (UMD like `cuttext.js`): `create()` keeps per agent `{kind, text, lines}` from events; `phrase()` builds tool phrases; `lastSentences()` picks the newest whole sentences; masking is injected (`{redact, cmd, url}`), so `scripts/test-liveact.ts` runs it in Node with the real `redact.ts`. A per-agent throttle (`due(id, now)`) allows one paint per 250 ms; a trailing timer paints the last text.
- **Layout.** `CANDIDATES` gains `['full',3,'side']` and `['full',2,'side']` before the plain `full` ones; `LIVE_SIDE` is set while a candidate is probed, `unitHTML` adds a fixed `.liveside` box after the desk (before helpers) and `unitWidth` counts it, so the existing fit check (`chooseLayout`) decides. The layout key includes the setting.
- **Paint.** The stage HTML renders the readout from the model; between renders `paintLive(a)` sets `textContent` of `[data-live="<id>"]` nodes only (no `scheduleRender`, no layout change).
- **Risks.** Thinking text can be long and fast: the model keeps only the last 1200 characters of a block. A secret in reasoning text is masked by `redact` patterns only (env values are unknown in the page): `[KNOWN GAP]` same as the chat, which shows that text unmasked today.

## Delta 2026-10-22: office rail, who is at a place, room header words (FR-034..FR-038)

- **Reuse.** Needs you: `needsMe`, `needsMeOrder`, `NEED_SINCE`, `ATT.waitLabel`, `openInbox`, `openPanel` (spec 052). Schedules: `SCHED`, `whenOf`, `clock`, `recurringS`, `openSchedules(room)`, `window.DurbarScreens.openSettings()` with the `#schedSet` section (spec 044). Figures: `avatar(a)`. Lobby: `lobbyHTML`, `placeVisitors`, `VISITS.at`, `layoutSpots`, `syncWalkers` (unchanged: it finds `.slot[data-slot=i]` inside each tile). Activity: `LIVEACT.of(id)` (already masked, FR-031). Menu: the shared `#modeMenu` element and `closeModeMenu` (as `openFolderMenu`). Header fitting: `fitUsage`.
- **Rail DOM.** `<aside id="rail">` after `#floor` inside `#stage-host` (`display:contents`, so the rail is a flex child of `.workspace` and hides with the office in the list view and with the chat open). `data-mode="rail|strip"`, fixed widths (248 px / 52 px) as CSS variables; colours from theme tokens. Painted by `renderRail()` from `renderAll` (no layout search: its rows never change the floor's width, only the mode does).
- **Layout.** `renderOffice()` reads the width of `.workspace` (floor + rail) for the layout key. For mode `rail` then `strip`: set `rail.dataset.mode`, read the floor's inner size, run `chooseLayout`; keep `rail` when `fit && d !== 'micro'`; else `strip`. The result is cached with the key, so a status change does not search again; a sparse office searches once.
- **Lobby.** `places.js` gains pure `tileChips(aw, tiles, addButton)` -> `{mode:'named'|'initials', slots}` (same tile width formula as `tileSlots`; named entry 92 px, initials entry 40 px, gap 6 px, padding 20 px, clamped 1..6); `test:places` covers it. Each tile: header row (icon, name, count) and an entries row; each entry holds the `.slot` (the figure's spot) and the text. `+N` is a `<button class="pv-more" data-placemore>`; it opens `openPlaceMenu`. The lobby height becomes 58 px (CSS; `check:office` expects it).
- **Header words.** `.rd` gains `<span class="rdw">working</span>`; `fitUsage` tries words, then `.no-words`, then `.no-path`.
- **Simulator.** `?simsched=1` seeds three schedules in the simulator bridge (`src/renderer/sim.ts`), for the driver and screenshots; nothing else changes in the simulator.
- **Risks.** One more layout search when the rail does not fit (1280x800 with 15 agents): measured with `shots-033`/`check:perf` budget (SC-004). The lobby gets 22 px taller: measured by the layout search (it may pick a smaller density; the checks enforce fit and 10.5 px). PR #462 (coffee corner) edits the same lobby tile and `check:office`'s lobby height: whichever lands second rebases.

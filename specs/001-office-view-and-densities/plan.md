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
- **Pure helper** in `src/renderer/probe.js`: `GCOL` (main 300-520 px, reply 260-440 px, facts 200-320 px, gap 16 px) and `grownCols(room, {reply})` -> `{n, main, reply, side}` (n = 1, 2 or 3; widths never above the maxima; 0 for a column not shown). `test:probe` covers it.
- **Render.** After `renderOffice` (where `fitLines` already runs), for each grown card: measure its width, `grownCols`, set `data-gc` and `--gm`/`--gr`/`--gs` on the card, then `fitLines` on the stream and the reply. The card's `max-width` is the sum of its columns, so a wide room does not stretch the lines. The probe never sets `data-gc` (the height does not depend on it).
- **Data.** `liveact.js` keeps the last tool phrase of the turn (`tool`, cleared with the readout at the turn's end) and `of()` returns it; `setState` sets `a.busySince` when an agent turns busy and clears it when it is Done or Idle; the 30 s tick includes it.
- **CSS.** `.stage[data-d="roomy"][data-grow]`: `--cmax` 1600 px; `.desk.card[data-gc]` grid columns `var(--sw) var(--gm) [var(--gr)] [var(--gs)]`; `.gx` hidden without `data-gc` and in the probe; `data-gc="2"` stacks reply over facts; facts one line each with an ellipsis. Theme tokens only, no font-size under 10.5 px, no transition.
- **Checks.** `test:probe` (`grownCols`), `test:liveact` (`tool`), `check:office-fill` (1 and 2 agents at 1440x900, 1280x800, 1920x1080: `data-gc` >= 2, characters per line <= 90 measured per line, page rules); screenshots `001-fill-{1,4,6}-1440x900.png`, `001-fill-1-1920x1080.png`.

## Delta 2026-10-22: grown desks when there are few agents (FR-041..FR-046)

- **Reuse.** `chooseLayout` and `probeSet` (one probe, the same fit test), the `roomy` card from `cardHTML`, its column search and grid (`--cols`, `--cmax`), the readout from `liveact.js` (`of(id)`), `paintLive`, `fitSide` (bottom-anchored text with a top fade, from the side panel), `fitUsage`. No new layout system: a grown desk is a `roomy` card with one more custom property.
- **Pure helpers in the existing `src/renderer/probe.js`** (the layout search's trial helpers, FR-033; no new module): `GROW` constants (min 1.0, max 2.5, step 0.1, two-line title from 1.4), `largest(fits, lo, hi, step)` (binary search over the steps of a monotone fit test), `better(a, b)` (larger *f*, then more of the floor's height, then fewer columns) and `pick(cols, lo, trial)` that runs both over the column counts. `scripts/test-probe.ts` (`npm run test:probe`) tests them with synthetic fit tests and a simple box model of rooms.
- **Layout.** After the candidate loop, when the result is `full` or `roomy` and no density is forced, `growSearch` sets `GROW` (the HTML of a grown card) and, per column count, puts the stage HTML in the probe once (`probeSet`, so column changes are set in place) and then only changes `--gf` and `data-grow` on the probe for each *f*. The layout result gains `grow` (*f*, or 0); `renderOffice` sets `--gf` and `data-grow` (`1`, or `2` from *f* 1.4) on the stage. The layout key is unchanged: *f* follows from the same inputs.
- **CSS** (`styles.css`, theme tokens only): `.stage[data-d="roomy"][data-grow]` scales `--cmax`, `--sw` and the card height by `--gf`; the text line becomes a flex column that fills the card (max 8 lines), `.over` anchors it at the bottom with the side panel's fade; `data-grow="2"` lets the name wrap to two lines.
- **Text.** `liveact.js` keeps a third, longer form of the readout (`long`, 600 characters, the newest sentences). `deskLine(a)` in grown mode returns the kind word and `long`, or for Done/Idle the start of `a.lastOutput` (plain words from `DurbarLiveAct.plain`, masked by `DurbarRedact.redact`, cut with `DurbarCutText`), or `taskOf(a)`.
- **Simulator.** `sim.ts` reads `simrooms=<1..5>` (agents in that many folders, in blocks) and `simhelpers=0` (no helpers) from the page address itself, like `simkinds`, so the option list in `app.js` is unchanged.
- **Checks.** `scripts/check-office-fill.js` (driver; `npm run check:office-fill`, listed in `scripts/ui-suite.js`); `check:office`, `check:geometry`, `shots-001-live-activity` (its sparse part now forces `full` to keep checking the side panel, and checks the grown desk instead in the default layout).
- **Risks.** Theme fonts: the fit is measured per theme, so a theme whose header is a fraction of a pixel taller could pick a different *f*; `check:geometry` runs with 12 and 15 agents, where 12 can grow, and catches it. Cost: up to about 5 trials per column count when few agents are on the floor (cheap: few elements); none at 15 agents.
- **Review of #532 (T062-T065).** `liveact.js` `excerpt(raw, redact)`: `plain(redact(raw))`, '' without a working mask; `grownLine` cuts it to 600 or shows `Finished.`/`Ready.` (never `taskOf`, which for a Done agent is the unmasked reply until #541 lands). `long` is no longer computed per delta: the model keeps the masked `body` and `of()` returns `long` as a getter that computes and caches it; a body change counts as a change only once a grown desk has read `long`. `chooseLayout` sets `GROW=0` first. The `redact.ts` underscore fix (spec 012 FR-080 delta) is PR #543's, not this PR's (T063). #541's `safetext.js` and `excerpt` become one helper (T066).

## Delta 2026-10-21: live activity on the desks (FR-028..FR-032)

- **Reuse.** Events: the normalized `thinking`, `output` and `toolCall` events already reaching `onLiveEvent` in `src/renderer/app.js` (no adapter or `src/shared` type change). Desk text: the existing `.task` (`full`) and `.intent` (cards) line from `taskOf(a)`. Tool words: `toolKind`, `toolLabel` and, in Simple, `plainChip` (spec 052 FR-081). Cutting: `DurbarCutText.cutText`. Masking: `src/shared/redact.ts` (`redact`, `maskSecretCommand`, `maskSecretUrl`), loaded in the page as the compiled `dist/shared/redact.js` behind a two-line `exports` shim (`src/renderer/exports-shim.js`), because the module has no imports. Setting: the Spacing pattern (`localStorage`, Settings > General).
- **New pure module** `src/renderer/liveact.js` (UMD like `cuttext.js`): `create()` keeps per agent `{kind, text, lines}` from events; `phrase()` builds tool phrases; `lastSentences()` picks the newest whole sentences; masking is injected (`{redact, cmd, url}`), so `scripts/test-liveact.ts` runs it in Node with the real `redact.ts`. A per-agent throttle (`due(id, now)`) allows one paint per 250 ms; a trailing timer paints the last text.
- **Layout.** `CANDIDATES` gains `['full',3,'side']` and `['full',2,'side']` before the plain `full` ones; `LIVE_SIDE` is set while a candidate is probed, `unitHTML` adds a fixed `.liveside` box after the desk (before helpers) and `unitWidth` counts it, so the existing fit check (`chooseLayout`) decides. The layout key includes the setting.
- **Paint.** The stage HTML renders the readout from the model; between renders `paintLive(a)` sets `textContent` of `[data-live="<id>"]` nodes only (no `scheduleRender`, no layout change).
- **Risks.** Thinking text can be long and fast: the model keeps only the last 1200 characters of a block. A secret in reasoning text is masked by `redact` patterns only (env values are unknown in the page): `[KNOWN GAP]` same as the chat, which shows that text unmasked today.

# Implementation Plan: Real office mode (spec 097)

**Branch**: `097-real-office` (spec) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

A second renderer for the office. It reads the same model as flat, lays it out with a pure engine ported from the B2 mockup (`b2.js`), draws realistic raster people, desks, monitors and lobby fixtures from a shipped, lazy-loaded WebP pack, and adds a CSS light layer driven by status. Phase P1 is the static scene with real art and the lights; P2 adds live screens and motion; P3 adds My characters (spec 096) and issue #692's manual lighting. Flat stays the default and is not touched.

## Technical Context

- **Language**: plain JS in the renderer (`src/renderer/*.js`, no bundler, like `places.js`, `crew.js`), TypeScript for pure shared logic that tests import (`src/shared/realoffice-layout.ts`, `src/shared/lights.ts`), compiled to the renderer as the other shared modules are (`exports-shim.js` pattern).
- **Dependencies**: none new.
- **Storage**: renderer `localStorage` only (`durbar.officeview`, `durbar.realpeople`, P3 `durbar.lighting`).
- **Testing**: `scripts/test-realoffice-layout.ts`, `scripts/test-lights.ts`, `scripts/test-realoffice-assets.ts` (node); `scripts/check-office-overlap.js` Real office variant and `scripts/shots-docs.js` drivers (Electron, simulator, xvfb on CI).
- **Performance**: layout under 5 ms for 40 agents; repaint only on model change or resize (one per animation frame); screens at most every 2 s; animations CSS only.
- **Constraints**: 10.5 px floor, 15 agents at 1440x900 and 1280x800, CSP unchanged in P1-P2, no blur, reduced motion and Serious mode.

## Architecture

```
officeModel(), agents, VISITS, status labels   (app.js, unchanged)
            │
            ├─ flat: renderOffice()             (unchanged)
            └─ real: DurbarRealOffice.render(model, viewport)
                   ├─ realLayout()        pure: rows, zones, desks, lobby, screens   (src/shared/realoffice-layout.ts)
                   ├─ lightFor()          pure: status + flags → lamp/glow/call/motion (src/shared/lights.ts)
                   ├─ pickPerson()        session → p01..p15 (crew pick pattern)
                   ├─ draw                DOM: absolutely placed <img>, <button> plates, screens (src/renderer/realoffice.js)
                   ├─ screens             lines from the live readout source, masked (DurbarSafeText), textContent
                   └─ lights layer        CSS classes + custom properties (src/renderer/realoffice.css)
```

- **Mode switch** (`app.js`): `renderAll` checks `officeView()` (reads `durbar.officeview`); `real` calls `DurbarRealOffice.render` in place of `renderOffice`; the List view is unaffected. The first switch to `real` injects `realoffice.js` and `realoffice.css` (`<script>`/`<link>` from `'self'`) and awaits `people.json`. `walkers` (`syncWalkers`) are not used in Real office.
- **Settings** (`screens.js` `signsRow()`): a third button `data-officelayout="real"`; the handler reuses `setSignsOn`'s confirmation when leaving cabins (FR-004), then sets `durbar.officeview`.
- **As built in P1 (2026-10-31)**: the search is over splits of the folders into groups, not orders (spec *Changes*); `people.json` ships as `realoffice/art/people.js` (no `connect-src` in the CSP); the compiled shared modules are page scripts, so their private names carry a prefix (`ro*`, `lightOwn`); the lobby widths come from the pure `lobbyWidths` (owner 2026-10-31 09:03); the WebP chunk walker moved to `scripts/webpinfo.ts`, shared by both asset tests.
- **Layout engine** (`realLayout`): a port of `b2.js` `render`, `rowGeom`, `zone`, `station` and `lobby` geometry into a pure function returning rectangles. Changes from the mockup: the `u` floor and cap (FR-012), fixtures scaled whole (FR-023), the order search capped past 7 folders (FR-011), plate height per row maximum over possible states (FR-015), lobby crowding and plate-only slots (FR-025), zoom placement as its own pure function `zoomRect(target, avoid[], viewport)` (FR-034).
- **Drawing**: one container, absolutely placed children keyed by agent id; a re-render updates positions and classes in place (no `innerHTML` rebuild of screens, so the zoom and focus survive). Plates are `<button>`s with accessible names (FR-090).
- **Screens**: lines come from the same per-agent readout buffer `liveact.js` keeps for the desk readout, after `DurbarSafeText` masking (FR-030); `realoffice.js` keeps the last 24 lines per agent, strips ANSI, cuts to 200 characters and sets `textContent` per line. No Markdown, no links.
- **As built in P2 (2026-10-31)**: the lines live in `liveact.js` (`screen(id)`, `block`), beside the readout, not in `realoffice.js`; text in the chrome layer over the glass; repaints are per screen and dirty-driven, with no idle timer; two frames are stacked pictures with inverse stepped opacity on one clock per desk; a desk scrolled away or wholly under the zoom pauses (`.ro-off`). Rules from the budgets delta: FR-180, FR-181, FR-182.
- **Lights**: `lightFor` gives `{lamp: 'warm'|'bright'|'on'|'low'|'off', glow: 'on'|'breathe'|'red'|'low'|'off', call: 'amber'|'red'|'orange'|'green-once'|null, motion: 'pulse'|'breathe'|null}`; the renderer maps it to classes on the desk's light layer (`.lamp`, `.glow`, `.call`) drawn between the art and the chrome (z-order: floor and fixtures < people and desks < lights < screens text, plates, signs, chips). The room ambient is one overlay on the art container with opacity from the active share (FR-043). Fixture lights are classes on the fixture from visits.
- **Provenance limit**: re-encoding strips the generator's C2PA manifest, so `ASSETS.md` is the only provenance (FR-069, known limit).
- **Characters (Q6, answered in part 2026-10-31)**: D3 is reversed; `crew.js` `realOfficeSet(choice)` is the seam that picks the character set and scene for Real office (FR-084); today every choice draws the Office people, and a crew adds FR-083's Settings note. How the scene adapts to the crews' own art waits for a proposal.
- **Art pack**: `src/renderer/realoffice/art/` (WebP + `people.json` + `ASSETS.md`), copied by `scripts/copy-assets.js` (add the folder to its list). The build PR converts the mockup files: fixtures from PNG to WebP, re-cropped to a common floor line; persons re-encoded at 0.80 with metadata stripped (reuse `stripChunks`/chunk walker from `scripts/test-crew-assets.ts`, or 096's `webpcheck.ts` if merged first).
- **P3 My characters**: 096's `STYLE_PRESETS` gets `real-office-front-v1`; 096's encoder computes the seat metadata; `pickPerson` consults 096's pins and the Characters setting `mine`.
- **P3 Lighting**: room menu and desk menu items (reuse the existing room menu and desk context menu builders), `durbar.lighting` read and pruned in a pure helper `cleanLighting()` in `src/shared/lights.ts`.

## Code paths reused (spec 021 FR-031; do not add parallel versions)

- Model, sort and visits: `officeModel`, `prio`, `VISITS`, `places.js` (`pin`, `at`).
- Masking: `DurbarSafeText`, `redact.ts` functions, `LIVE_MASK`, main's `maskMcpEvent`.
- Settings row and confirmation: `signsRow()`, `setSignsOn`.
- Person pick: the crew's least-used pick (`pickCharacter`, `assignCrew`, `pruneCrew`) pattern, in a new store key.
- Asset checks: `scripts/test-crew-assets.ts` chunk walker.
- Overlap check: `scripts/check-office-overlap.js` (a mode flag, not a copy); screenshot drivers: `scripts/shots-docs.js`.
- Forced colours: the existing `forced-colors` rules in `styles.css`.

## Risks and how the plan answers them

| Risk | Answer |
|---|---|
| 10 MB of art slows start or memory in flat mode | Lazy load only in Real office (FR-061); SC-004 driver asserts no request in flat |
| Faces too small at 15 agents | `u` floor, score favouring larger `u`, SC-002 checked by the overlap variant; lobby faces kept honest as a target/gap |
| Secrets on screens | Reuse the desk readout masking; hostile simulator fixture; `textContent` only (SC-005) |
| Many animated pictures cost CPU | CSS `steps(1)` swaps and opacity only, paused when hidden, off under reduced motion/Serious; at most one animation per desk (FR-048) |
| Lights hurt readability | Chrome above the light layer, contrast measured at 70 % and 100 % ambient (FR-044, FR-050), off in forced colours |
| Layout search too slow with many folders | Order search capped past 7 folders; unit test timing on 40 agents |
| Art looks uneven (fixture crops, person scale) | Re-crop to a common floor line; per-picture metadata; owner review of P1 screenshots (SC-008) |
| Drift between flat and Real office behaviour | Same model, same click and keyboard handlers (FR-005, FR-006) |

## Phases (one PR each; the spec PR is phase 0)

- **P1 Static scene and lights** (US1, US2): art pack + asset test, `realLayout` + tests, `lightFor` + tests, `realoffice.js/css` drawing with still poses, setting button, overlap variant, screenshots, owner review.
- **P2 Screens and motion** (US3, US4): masked screens, zoom placement, 2-frame poses, visitor motion, cross-fades, pause when hidden.
- **P3 My characters and manual lighting** (US5): `real-office-front-v1` preset (needs 096 P2-P4 merged), pins; #692 levels, menus, storage.

## Testing

- **Unit** (`test:realoffice-layout`): 1, 2, 4, 5, 15, 40 agents; 1-8 folders; away agents; waving rows; chat open widths; both sizes; no overlap, inside bounds, `u` limits, status order, no jump when a status changes (same rects), timing under 5 ms for 40. `zoomRect` never covers the avoid list and stays in the viewport.
- **Unit** (`test:lights`): every status and flag row of FR-041; done tick once; active share to ambient; reduced motion strips motion; `cleanLighting` on malformed, wrong version, oversized and stale data; manual levels never remove call/error cues.
- **Unit** (`test:realoffice-assets`): every file WebP with alpha, no metadata, within caps, total ≤ 10 MB, `people.json` complete and in range, `ASSETS.md` row per source sheet with the required fields, and for every person entry the fictional-people prompt clause and a `likeness-check` approver-and-date field (FR-067, FR-068; T023).
- **Screen text** (in `test:realoffice-layout` or `test-safetext`): hostile strings (token, MCP secret value, `~/` path, `<img onerror>`, Markdown link, ANSI, 1 MB) give masked, inert, capped lines.
- **Driver** (`check:office`, Real office variant): SIM 12 and 15 at 1440x900 and 1280x800, chat closed and open; overlap, clipping, 10.5 px, overflow, desk face size, plate contrast at two ambients; flat mode loads no Real office file.
- **Screenshots** (`shots:docs`): 15 and 3 agents at both sizes, lights per status, hover zoom; each with a `DOC_SHOTS` driver.

## Constitution Check

Passes; see spec *Constitution check*. No new runtime dependency; no IPC; no adapter change; CSP unchanged until P3 (`blob:` comes from 096 FR-043, not from this spec).

## Complexity Tracking

| Item | Why | Simpler option rejected |
|---|---|---|
| A second office renderer | The realistic look needs geometry the flat card layout cannot give (people behind desks, screens, lobby band) | Theming the flat office: tried as scene kits; the owner said it still "looks like a dashboard" |
| 10 MB art pack | 15 people × 11 poses at 2x the shown size | Fewer people repeat too often at 15 agents; smaller pictures blur at n ≤ 4 |

## Worlds, the lift and the chat in the world (delta 2026-10-31, branch `097-real-office-worlds`)

- **World seam**: P1's `realOfficeSet(choice)` (`crew.js`, FR-084) grows into `realOfficeWorld(characters, worldPref)` → `{ world, people, note }`; `REAL_OFFICE_WORLDS` lists the shippable worlds and `test:surfaces` (spec 098) compares it with the registry (FR-112, FR-114).
- **Packs**: `src/renderer/realoffice/worlds/<id>/` with `world.json` (spec 098 FR-031: blocks, anchors, `realHeight`, tokens, light-slot shapes), `world.css` (tokens plus world-moment rules only; 098 FR-040), pictures. Loaded by the existing lazy loader per world (FR-115); `scripts/copy-assets.js` copies the folder.
- **Lift**: `renderLift` (`app.js`, 092) keeps the DOM and semantics; in Real office the world layer adds the shaft class, the cabin and reverses the drawn order for FR-116 (a pure helper `liftOrder(floors, natural)` in `floornav`, unit-tested, also giving PageUp/PageDown's direction). The ride uses 092's `motion()` slide (phase 3) with a world cover clipped to the desk area (FR-102).
- **Chat**: `openPanel` keeps the panel; the world layer adds the column and the portrait when Real office is on and the window is at least 1200 px wide (FR-106); cards get a tail class only.
- **Bubble and slip**: the inbox/answer-bar component renders into a bubble or slip frame (098 blocks); placement through `zoomRect` (FR-034) with plates, chips and the lift in the avoid list (FR-108..FR-110).
- **Grounding**: `realLayout`'s lobby step places standing frames by `floorLine` and scales them by fixture px-per-metre (FR-117); the contact shadow is a CSS ellipse in the same rect.
- **Checks**: spec 098's `test:surfaces`, `test:world-packs`, token lint and world matrix hold the worlds; 097's `check:office` Real office variant runs per world for the fit, grounding and contrast checks.

## The chat in the world inside the denser chat (delta 2026-11-01; FR-224..FR-227)

Order: row 9 of [spec 005's plan table](../005-chat-fullscreen-and-agent-strip/plan.md). #1001 built the portrait's size, `lampWords` in the header painter and tokens in place of literals, and has landed; the 61 px header and `--chat-prose` come with spec 005's chat PRs. No new file. Constitution V: the header keeps its target with the world on. FR-113 and FR-130 stand.

## The chat and Settings look like the room (delta 2026-11-02; FR-231..FR-235)

Order: rows A15..A18 of [spec 005's plan table](../005-chat-fullscreen-and-agent-strip/plan.md). Tokens and the surface colour: [spec 070](../070-theme-tokens/spec.md) FR-068..FR-074. No new runtime dependency. Constitution V: no text on art, sizes unchanged but prose, contrast by test; art is one static background per surface, with no blur, blend or filter (FR-180, FR-182).

## Attention lights (delta 2026-11-04; FR-236..FR-238, FR-243, FR-244, T185..T193)

Owner decisions (Vikram, Telegram DMs, 2026-11-04):
- 04:38 UTC: round 3's D1, without D4's Boss-door glow.
- 04:52 UTC: "Ok, just add light without any dusk". FR-239..FR-242 are withdrawn; FR-043, FR-047 and FR-182 are unchanged.

Spec *Changes* has the requirements and the honest limits. This is PR 1 (spec only). PR 2 builds it in the order below.

- **Geometry, pure** (`src/shared/realoffice-layout.ts`, T185). `lightBar(desk, lay)` returns `{bar, clamp, bezel, pool, poolHole, onEdge}` for each `DeskBox`, from the `screen` and `glass` rects already there. The rules are tested where they are made:
  - the bar inside the monitor's span;
  - the pool narrowed, then lowered, clear of every `face` box;
  - `onEdge` when a `ZoneBox.sign` or other chrome rect the layout places overlaps the bar's normal place.

  No DOM: unit-tested on every OS (FR-019 stays under 5 ms).
- **State, pure** (`src/shared/lights.ts`, T186).
  - `Light` gains `bar: 'off'|'amber'|'red'|'orange'|'green'`, and `LIGHT_TABLE` gains the *Bar* column.
  - `lightFor(state, { still, unread })`: unread turns an off bar green and nothing else.
  - `lampWords` is unchanged: the words for green are the tag's.
- **Drawing** (`src/renderer/realoffice.js`, `realoffice.css`, T187).
  - Bar, clamp, bezel and pool sit in `.ro-lights` (under the chrome), one set per desk, created once and switched by class (`bar-amber` ...). A status change adds no node and no layout read (FR-244).
  - The New reply tag is a `<span aria-hidden="true">` in `.ro-chrome`, placed from the plate's rect, shown by class from `isUnread(a)`. The plate's `aria-label` takes `unreadWords(a)`.
  - Forced colours, reduced motion and Serious mode use the existing `.ro.still` and media rules.
- **Reused, not added** (spec 021 FR-031):
  - `isUnread` and `unreadWords` (`app.js`, DurbarUnread), not a second unread store;
  - the existing light layer, its `--ro-*` colours and the FR-049 fixed-colour rule;
  - `lightState`'s precedence;
  - the layout's `face` boxes (the same ones `portraitCrop` uses);
  - FR-050's contrast pass in `check-office-overlap.js`;
  - `check-office-ops.js` for the op rows;
  - `shots-097-realoffice.js` for pictures.
- **Cost** (T190, T192): count checks only.
  - `check-office-ops` counts 0 nodes and no extra layout reads for a status change that lights a bar.
  - `test:theme-tokens` finds no `backdrop-filter`, `filter` or `mix-blend-mode` in the bar rules and no animation of anything but `opacity`.
  - No frame-time measurement: the bar is gradients and opacity only.
- **Constitution.**
  - V: no state by colour alone (tag, plate words); no motion in the bar; text never on art.
  - III: no new storage or IPC; the tag shows no content.
  - VI: CSS and pure TS only.
  - VIII: the mock's limits are in the spec.

## The lounge row (delta 2026-11-06; FR-246..FR-249, T199..T203, issue #1220)

One PR, spec first. Who moves is `shutPlan(r)` (spec 001 FR-051, `shutters.js` `roomPlan`): app.js's `realModel` already receives `m.rolled`; it marks those agents `lounge: true` and gives them the lounge words. Nothing else in the app decides it.

- **Engine, pure** (`src/shared/realoffice-layout.ts`, T199): `realLayout` takes the lounge agents out of their folders, works out the row's height (`loungeRow`), searches the desk rows in the floor minus that height (the lobby keeps its range from the whole height) and places the seats under the last desk row. `Layout.lounge = {box, desks}`: each seat is a `DeskBox` with `lounge: true`, a `table` rect (the small desk) and the usual `person`, `face`, `screen`, `glass`, `plate`, `lamp`, so the renderer and `slipAvoid` reuse the desk code. `ASLEEP_W` and the slim desk go.
- **Arcade, pure** (`src/shared/realoffice-arrangements.ts`, T200): the same split; the seats take cells after the cabinets (`packSeats(sizes, cols, keep, extra)` fills the rows' free cells, the last row first, then new rows) and `planFor` counts them, so the plan is never worse than with those agents at cabinets.
- **Renderer** (`src/renderer/realoffice.js`, T201): the desk loop body becomes `deskOne(d)`, run for the zones' desks and then the lounge's; a seat draws the world's `desk.webp` small (`ld:` key) instead of the desk or cabinet, no screen text, a still person, the same plate, monitor, lamp and "z z"; seat plates are moved after the desks' plates for Tab. `sweep` fades a leaving desk picture; a new one fades in. The ease is `box()`'s.
- **CSS**: `.ro-lseat` table, `.ro-lmon` monitor (photo and cave: the desk monitor scaled; arcade: a pixel frame in `worlds/retro/world.css`), `.ro-plate.lounge`.
- **Checks**: `test:realoffice-layout` and `test-realoffice-aisles` (FR-246..FR-248, mutants), `scripts/check-097-lounge.js` (FR-246..FR-249), `shots-097-moments` asleep moment and `world-matrix.js` lounge scene updated.

## A desk's helpers in the room (delta 2026-11-07; FR-306..FR-311, T205..T210, issue #1139)

Spec first; the build waits for the owner's answer to Q7. If the answer is (a), the build is one PR, reusing the flat office's pieces (spec 001 FR-089..FR-097): `visibleHelpers` for order, cap and `+N more`; `helpercard.js` `view` and `html` for the card's masked, cut lines and its `aria` and `title`; the `[data-id]` and `[data-more]` handlers already in `app.js`.

- **Engine, pure** (`src/shared/realoffice-layout.ts`, T206): a `helpers` count on `RealAgent`; `roRowGeom` adds the strip's fixed height (by level) to a row that holds such a desk; the helper level is one more step after the `u` search, kept only while `u` stays at least 1.4x the level-0 `u`; each `DeskBox` gains `strip: Rect & { level, shown }`; `slipAvoid` includes the strips. Measured in a scratch copy: a 22-44 px band under every row keeps the 15-agent face at 31.8 px (1280x800) and 36.0 px (1440x900).
- **Renderer** (`src/renderer/realoffice.js`, T207): in `deskOne`, after the plate and its pencil, an `h:` keyed strip of buttons in the chrome layer; `plateFill` keeps its `+N` for the fallback only. `drawSlips`/`put()` are not touched (another lane owns them).
- **CSS** (`src/renderer/realoffice.css`): `.ro-help-tile`, `.ro-help-card` on the plate's tokens; the cave's plate look by its world class.
- **Checks**: `test:realoffice-layout` (FR-311's cases and mutants), `scripts/check-097-helpers.js`, `OFFICE_VIEW=real check-office-overlap.js`, `shots-097-realoffice`.

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
- **Layout engine** (`realLayout`): a port of `b2.js` `render`, `rowGeom`, `zone`, `station` and `lobby` geometry into a pure function returning rectangles. Changes from the mockup: the `u` floor and cap (FR-012), fixtures scaled whole (FR-023), the order search capped past 7 folders (FR-011), plate height per row maximum over possible states (FR-015), lobby crowding and plate-only slots (FR-025), zoom placement as its own pure function `zoomRect(target, avoid[], viewport)` (FR-034).
- **Drawing**: one container, absolutely placed children keyed by agent id; a re-render updates positions and classes in place (no `innerHTML` rebuild of screens, so the zoom and focus survive). Plates are `<button>`s with accessible names (FR-090).
- **Screens**: lines come from the same per-agent readout buffer `liveact.js` keeps for the desk readout, after `DurbarSafeText` masking (FR-030); `realoffice.js` keeps the last 24 lines per agent, strips ANSI, cuts to 200 characters and sets `textContent` per line. No Markdown, no links.
- **Lights**: `lightFor` gives `{lamp: 'warm'|'bright'|'on'|'low'|'off', glow: 'on'|'breathe'|'red'|'low'|'off', call: 'amber'|'red'|'orange'|'green-once'|null, motion: 'pulse'|'breathe'|null}`; the renderer maps it to classes on the desk's light layer (`.lamp`, `.glow`, `.call`) drawn between the art and the chrome (z-order: floor and fixtures < people and desks < lights < screens text, plates, signs, chips). The room ambient is one overlay on the art container with opacity from the active share (FR-043). Fixture lights are classes on the fixture from visits.
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
- **Unit** (`test:realoffice-assets`): every file WebP with alpha, no metadata, within caps, total ≤ 10 MB, `people.json` complete and in range, `ASSETS.md` row per source sheet with the required fields.
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

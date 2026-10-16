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
| Chat open at both sizes: no page overflow, no horizontal overflow in `#chat`, strip has all agents | same | pass |
| Chat open densities (README: `card` at 1440x900, `mini` at 1280x800) | README only | not re-run |
| Keyed updates keep animations | README measurement | not re-run |
| macOS and Windows rendering | none | untested |

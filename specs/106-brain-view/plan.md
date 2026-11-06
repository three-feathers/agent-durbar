# Implementation Plan: Brain view (spec 106)

**Branch**: `106-brain-view` (spec) | **Date**: 2026-11-06 | **Spec**: [spec.md](spec.md)

## Summary

One pure state source in `src/shared` turns an agent's normalized events into a brain state; a small set of plain-JS renderer modules draw it on Canvas 2D in three placements (dock, In front, office) and render its text views (card, sentence, lists, Your door items). No dependency, no adapter change, one new IPC channel (the export, P3). Built in four phases, one small PR per task group.

## Technical context

- **Language and stack**: TypeScript in `src/shared` (compiled to CommonJS with no imports, loaded as a page script through `exports-shim.js` as `redact.js` and `realoffice-layout.js` are); plain JS UMD modules in `src/renderer/brainview/` (`window.DurbarBrain*` in the page, `module.exports` in Node), as `liveact.js`, `mood.js` and `toolstats.js` are.
- **Dependencies**: none new. Canvas 2D is the browser's.
- **Storage**: none on disk, except the user's export (P3) and two display settings through `setting()` in `src/main/settings.ts` (`brainView`, `brainMotion`) and the window's display preference for Docked or In front (the navigator shortcut's store, 074 FR-013).
- **Testing**: Node unit tests (`scripts/test-brain*.ts`, in `npm test`), simulator drivers (`scripts/check-brain*.js`, `until()` waits, both sizes), `check:perf --record` rows, op counts in the pull-request suite (097 FR-186). Zero AI credits.
- **Targets**: Windows, macOS, Linux; 1440x900 and 1280x800; device pixel ratios 1 to 2.
- **Performance goals**: spec FR-100..FR-105.

## Architecture

| Unit | Kind | Job | Spec |
|---|---|---|---|
| `src/shared/brainstate.ts` | pure TS | The reducer `brainState(prev, event, now, mask)`: turns, steps, glyph table, trail, card, sentence phrases, loop rule, mood from injected timers, counts. `mask` is redact's functions passed in (the compiled file must have no imports); Node tests pass `redact.ts` itself. | FR-001..FR-008, FR-012, FR-020..FR-022, FR-040..FR-042, FR-062, FR-063 |
| `src/shared/brainsurface.ts` | pure TS | One formatter per surface of FR-085's table (office tag, popover, card, transcript, turn map, export, share) from a state step. The masking table lives here only. | FR-021, FR-080, FR-085, FR-086 |
| `src/shared/brainplace.ts` | pure TS | Office placement: picks at most 3 brains and the orbs, places each beside its own person with `realoffice-layout.ts`'s `placeBox` and `slipAvoid` (Real office) or the desk rectangles (Flat); dock sizes from Your door's item count. | FR-030, FR-031, FR-034, FR-037 |
| `src/shared/braininsight.ts` | pure TS | Habits shares, the day table rows and turn strips, the fixed describe phrases; the stale-read detector over file-change events with platform path rules. | FR-070..FR-076 |
| `src/renderer/brainview/points.js` | UMD | Precomputed point sets (2.5k, 6k, 10k) and lobe masks, generated at build time into a JSON module; glow sprites built once per skin into offscreen canvases. | FR-010, FR-011, FR-100 |
| `src/renderer/brainview/draw.js` | UMD | The Canvas 2D renderer: one canvas per placement, draws on state change or while an animation runs, stops when hidden; Full, Calm, Still; bloom; forced colours. | FR-010, FR-013, FR-051, FR-060, FR-061, FR-096, FR-100..FR-104 |
| `src/renderer/brainview/dock.js` | UMD | The dock and In front: header, cost line, legend, card, sentence, *Latest steps*, turn map lists, the shortcut, focus and the live-region queue. | FR-014, FR-015, FR-023..FR-025, FR-030..FR-033, FR-036, FR-050, FR-090..FR-095 |
| `src/renderer/brainview/skins/*.css` | CSS | Real office, Retro arcade, Flat: tokens, fonts and point shape only. | FR-110..FR-112 |
| `app.js` hooks | glue | Feed `agent:event` to the reducer (beside `liveact.js`), render the loop chip on desk cards and rail rows, add Your door items (loop, stale read), *Look*, *Stop…* (with `askDialog` and the existing Stop), Screen share. | FR-043..FR-046, FR-075, FR-080, FR-081 |
| `src/main/brainexport.ts` | main | The one new channel, `brain:exportTurnMap(agentId, png, text)`: size caps, masks the text again, main's own save dialog (as `notesexport.ts`), writes. Window-only, in `test:ipcchannels`, never in `durbar-mcp`. | FR-052 |

**IPC**: none new for P1, P2 and P4; events come on the existing `agent:event` push, settings through `setting()`. P3 adds `brain:exportTurnMap` only.

**Lazy loading**: `brainview/*` and the point sets are injected on first use, as `realoffice/art/people.js` is (FR-105); off means not loaded.

## Phases (one small PR per task group; line counts are estimates)

| Phase | Groups | Content | Gate |
|---|---|---|---|
| P0 | G0 | Owner's answer to Q1 (canvas exception) | Before any P1 code |
| P1 | G1 to G4 | State reducer and masking; dock with brain, card, sentence; accessibility; Full, Calm, Still; settings and shortcut; Real office and Flat skins | Q1 |
| P2 | G5 to G7 | Office brains and orbs; loop rule on every surface; Your door loop item with *Look* and *Stop…* | P1 |
| P3 | G8 to G10 | In front and presenter; turn map, bloom, export; Screen share; Retro arcade skin | P2 |
| P4 | G11, G12 | Habits and the day view; stale-read alert | P3 for the dock; independent of In front |

## Existing capability check (spec 021 FR-031)

Reused: `agent:event` (`onEvent`), `liveact.js` (event feed and repaint rate), `redact.ts` (all masking), `toolstats.js` (`toolKey`), `mood.js` and `shutters.js` timers, 097 FR-041's lamp rule, `attention.js` (oldest wait), `realoffice-layout.ts` (`placeBox`, `slipAvoid`), Your door (052 FR-216) and its item cards, `askDialog`, the composer's Stop and `interrupt`, `EditInfo` and `editview.js` diff rows, 074's shortcut recorder and clash check, `#srAnnounce`, `setting()`, `notesexport.ts`'s save-dialog pattern, draft messages (074 FR-022). Nothing existing draws a per-agent activity picture, a loop warning or a cross-agent stale-read alert, so those are new.

## Constitution check

- **I Spec Kit**: this spec, plan and tasks before any `src/` code. Pass.
- **II Adapters**: normalized events only; the tool table reads normalized `tool` names; missing `interrupt`, thinking or read paths degrade (FR-046, FR-076, FR-123). Pass.
- **III Safe by default**: read-only view; nothing sends or approves; masked state; approvals off while sharing; the export is masked twice and main owns the path. Pass.
- **IV No credits**: simulator and fixtures; a driver counts 0 adapter sends (SC-006). Pass.
- **V Calm UI**: 12 px and 11.5 px floors (above 10.5), 15 agents at both sizes, state by shape and word, motion stops under reduced motion and *Still*. **Exception**: "Motion is CSS-only" is not met: the brain animates on a canvas. See Complexity Tracking.
- **VI Platforms**: no OS-only code; ⌘ on a Mac; platform path compare in FR-075; `[KNOWN GAP]` no real macOS or Windows run until their owners check.
- **VII Quality gates**: unit tests, drivers at both sizes, screenshots per phase.
- **VIII Honest limits**: FR-130..FR-133; persona scores labelled simulated; mockups labelled.

## Complexity tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Constitution V, "Motion is CSS-only, coarse and cheap"; spec 102 FR-261's "nothing draws to a canvas" (for worlds) | 10,000 lit points with lobes that light by tool, a trail and a bloom cannot be CSS elements at FR-101's budgets; the owner's chosen look is a point cloud | CSS-animated sprite frames: one sheet per lobe, state and skin (7 lobes x moods x 3 skins x 3 sizes) is megabytes of pictures and still cannot draw a trail between arbitrary lobes. SVG: thousands of nodes recalculate per frame. **Time box**: the exception is scoped to `src/renderer/brainview/` and holds only with FR-102's asserted op counts and FR-104's pause; it needs the owner's yes (Q1) or a MINOR constitution amendment before P1, and is reviewed after P2's recorded perf rows. |

## Test strategy

- **Unit (Node, every OS)**: `test:brainstate` (turns, order FR-003, coalescing, caps, helpers, late events, the glyph table against every tool name in the simulator and adapter fixtures, moods by injected time, Serious mode); `test:brainloop` (rule (a) and (b), third tool clears, Think does not break, wording and cost, mutants); `test:brainsurface` (FR-086's table on every surface, planted mutations); `test:brainplace` (≤ 3 brains, needs-you order, orbs, no overlap, both sizes, Flat and Real office boxes); `test:braininsight` (shares, one unit, describe phrases only, stale-read cases incl. Windows and macOS case rules, never from command text); `test:brainexport` (caps, re-masking, no window path).
- **Drivers (simulator, `until()`, both sizes, 15 agents)**: `check-brain-dock` (placement, Your door count visible, legend, shortcut, focus order, live-region queue, Still); `check-brain-audit` (FR-098: overlaps, text floor, contrast against captured background pixels at rest, during swaps and bloom, focus ring, colour-blind simulation, forced colours emulation); `check-brain-office` (≤ 3 brains, orbs, fit, layout ops unchanged); `check-brain-loop` (chip, rail row, Your door, *Look* focus, *Stop…* focus on Cancel, *Review changes*, 0 sends); `check-brain-share` (placeholders, approvals disabled).
- **Performance**: op counts in the pull-request suite (FR-102); `check:perf --record` rows (FR-101), weekly, never asserted.
- **Screenshots**: each UI phase adds simulator screenshots at 1440x900 and 1280x800 under `docs/screenshots/`, with `DOC_SHOTS` entries.

## Risks

Canvas cost on weak GPUs (FR-131; op counts and pause rules guard it); text over a moving glow (FR-097 measured on real pixels); two live regions talking over each other (FR-091's queue); a masking gap on a new surface (one formatter module, FR-086 tests); the right rail amending 052 FR-216 (Q4); stale-read false alarms (FR-075 is strict; FR-076's gap).

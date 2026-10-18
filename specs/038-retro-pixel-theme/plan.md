# Plan: Retro pixel theme (spec 038)

## Approach
1. Extend the slot system with **pixel maps** (manifest `art` value of the object form): compile-once to `<rect>` SVG, reusing the sanitiser on the result.
2. Author the retro palette: saturated game hues with safe text pairs (ink on pill backgrounds ≥4.5:1 measured in tests).
3. Pixel slots: `hair-front` variants (bun/curly/short/long blocky), monitor with chunky bezel + scanline screen, mug, cactus plant, retro doors.
4. Words as in the spec; motion preset `arcade`.

## Files changed
- `src/renderer/theme.js` (pixel map support + pack), `src/renderer/app.js` (slot hooks only if the scene needs an extra slot point), tests.

## Risks
- Pixel maps inflating scene strings → grid ≤ 14×18 cells, cached by theme switch like other scenes.

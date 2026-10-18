# Plan: Durbar themes (spec 039)

## Approach
1. `hair-acc` slot: `hairFront()` appends `THEME.slot('hair-acc')` content at the head position (transform-free, static geometry) when present.
2. Palettes: build each on warm/cool accent sets; keep pill ink contrast ≥4.5:1 (measured in tests).
3. Words per the spec table (owner reviews on the PR).
4. Tests: per-pack word maps and accessory presence; check:themes matrix grows by three themes.

## Files changed
- `src/renderer/theme.js` (three packs), `src/renderer/app.js` (`hairFront` accessory hook), tests.

## Risks
- Cultural tone: word list is explicitly routed to the owner for review in the PR description; accessories stay abstract and geometric.

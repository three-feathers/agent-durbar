# Plan: Clean Office pack (spec 036)

## Goal
Every colour and scene word of today's office moves behind semantic tokens and word keys; Clean Office becomes the first complete built-in pack without a single pixel change.

## Approach
1. **Token census**: read every literal in `scene()`, `avatar()`, `hairFront()`, `badgeSVG`, `PLANT`, `DOOR_OPEN/SHUT`, `SIREN`, `linksSVG`, `PLACE_ICON`, `ICON` and `modeIcon`; define one `--…` token each in `CLEAN_TOKENS` with today's hex as the default.
2. **Tokenize styles.css**: room tints/walls at both densities, pill background/ink pairs, brand mark, `focus` ring, avatar/sav backgrounds, drop overlay → `var(--token, fallback)` where fallback keeps today's value (belt and braces: the token always exists at runtime).
3. **Word layer**: `THEME.word(key)` for place names, lobby label, door aria words; `data-place` / `data-key` ids on scene elements for scripts.
4. **Motion presets**: `THEME.motion(name)` resolves the active preset, honouring `prefers-reduced-motion` at call time (also at switch time via `THEME.setTheme` re-application).
5. **Main hook**: `DURBAR_THEME` env → `settingsStore` theme seed (dev only); preload exposes nothing new here (theme setting IPC arrives with the picker, spec 037 delta tasks).

## Files changed
- `src/renderer/theme.js` (tokens, words, motion, per-theme resolver)
- `src/renderer/app.js`, `src/renderer/styles.css` (token reads, `data-*` ids)
- `src/renderer/places.js`, `src/shared/places.ts` only if needed (ids stay stable)
- `scripts/shots-024.js` (data-* reads), `scripts/check-themes.js` (new, reuses the overlap driver), `src/main/main.ts` (DURBAR_THEME seed), `scripts/check-office-overlap.js` (theme param label only)
- Tests: `scripts/test-theme.ts` extended.

## Tests and checks
- `npm run typecheck`, `npm test`, `npm run check:office`, `npm run check:themes` (all built-ins, QUICK matrix allowed under xvfb).

## Risks
- Missing one literal → theme shows a hard-coded colour; mitigated by the census + visual check shots per theme.
- Byte-identical Clean Office output is the guardrail: compare `scene()` output before/after the change for every agent/state/mood combination the simulator produces.

# Plan: Corporate theme + picker (spec 037)

## Approach
1. **Pack**: author the corporate token map (cool neutrals: floors `#eef2f6`, surfaces `#f7fafc`, inks `#1f2a36`; steel desks `#c3ccd4`, glass monitors `#dfe9f2`) over the full 036 token census; art slots: understated plant, glass monitor bezel, cooler door tones.
2. **Words**: the six scene-word renames; never status/permission text.
3. **Picker**: Settings > Theme (screens.js), bridge `settings:setTheme` (SettingsStore `setTheme(id)` with validation), renderer applies via `THEME.setTheme`, clears the scene cache, re-renders, toasts "Theme: <name>".
4. **Tests**: theme tests per pack (tokens resolve, words map, fallback); contrast pairs table in tests.

## Files changed
- `src/renderer/theme.js` (pack), `src/renderer/screens.js` + `screens.css` (picker), `src/main/settings.ts`, `src/shared/credits.ts` (settings parse), `src/main/main.ts` (IPC), `src/preload/preload.ts` (bridge), `src/renderer/app.js` (apply on change), tests.

## Risks
- Corporate text-on-tint contrast at both densities → tests measure pairs; tune tokens until pass.

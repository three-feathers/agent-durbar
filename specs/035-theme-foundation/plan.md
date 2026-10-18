# Plan: Theme foundation (spec 035)

## Goal
Add a data-only theme system to the renderer that can later load built-in and user theme packs, without changing the visible office when Clean Office is active.

## Non-goal
Implement any new visual theme in this spec. Clean Office remains the only active output.

## Approach
1. **Token layer**: extract the colour variables that today live as literals in `styles.css` and in `scene()` into a semantic token map. The active map is applied as CSS custom properties on `document.documentElement`. Styles switch to `var(--token-name)` for theme-relevant colours; non-theme colours stay literal.
2. **Art slot layer**: split the inline SVG string builder in `scene()` into named slots (`body`, `head`, `hair-front`, `hair-back`, `eyes`, `mouth`, `shirt`, `pants`, `desk`, `chair`, `laptop`, `phone`). Clean Office provides the default SVG for each slot. `scene()` assembles the final SVG from slots and applies token-based fills/strokes.
3. **Theme loader**: a new `src/renderer/theme.js` UMD module reads a manifest object (later from JSON files; now from an in-memory default). It validates the manifest, sanitizes SVG slots, resolves token fallback to Clean Office, and exposes `getTheme()`, `token(name)`, `slot(name)`, `word(key)`.
4. **Settings hook**: add `theme` to the renderer settings store. On startup and on `settings:changed`, call `setTheme(themeId)`. Unknown or missing id falls back to `"clean-office"`.
5. **Scene cache key**: include `themeId` in `SC_CACHE` so theme switches invalidate cached scenes.
6. **Sanitization**: a small whitelist-based SVG cleaner rejects scripts, styles, event handlers, links, and foreign objects. Invalid/missing slots use Clean Office defaults.

## Files changed
- `src/renderer/theme.js` (new)
- `src/renderer/app.js` — use art slots + tokens in `scene()`, add `themeId` to `SC_CACHE`, call `setTheme()` on settings change
- `src/renderer/styles.css` — replace theme-relevant literals with CSS custom properties
- `src/renderer/index.html` — apply initial token set on load
- `src/renderer/settings.js` or equivalent — add `theme` key (handled in `app.js` settings read today)
- `scripts/test-theme.ts` (new)
- `specs/035-theme-foundation/` — spec.md, plan.md, tasks.md
- `package.json` — add `test:theme` if needed

## Tests and checks
- `npm run typecheck`
- `npm test` (includes new `test:theme`)
- `npm run check:office` must pass with no visible change for Clean Office

## Risks
- `scene()` is a long string builder; refactor into slots carefully to keep the exact same SVG output for Clean Office.
- Tokenizing CSS may unintentionally change a non-theme colour; compare screenshots before/after.
- Sanitization must be strict enough for user packs later, but not so strict that Clean Office defaults fail.

## Implementation phases

### Phase 1 — Token map and styles
- Define `src/renderer/theme.js` with the Clean Office default token map.
- Apply tokens as CSS custom properties on `document.documentElement`.
- Replace the most obvious theme-relevant literals in `styles.css` with `var(--*)`.
- Verify `check:office` still passes.

### Phase 2 — Art slots and scene builder
- Identify all SVG fragments emitted by `scene()` today.
- Extract them into a `CLEAN_OFFICE_SLOTS` map in `theme.js`.
- Rewrite `scene()` to assemble from slots; compare output byte-for-byte for Clean Office.
- Add `themeId` to `SC_CACHE`.

### Phase 3 — Settings and loader
- Read `theme` from settings; default `"clean-office"`.
- Add `setTheme(id)` that loads a manifest, validates it, sanitizes slots, and reapplies tokens.
- Handle `settings:changed` events.
- Wire fallback + console warnings.

### Phase 4 — Tests and docs
- `scripts/test-theme.ts` for manifest validation, fallback, sanitization.
- Update `specs/README.md` row for 035.
- Update `CHANGELOG.md` Unreleased section.

## Verification (phase 3, this spec)
- `test:theme` passes with mutation checks.
- `check:office` passes at 1440x900 and 1280x800.
- Boot with no `theme` setting: identical to before.
- Boot with `theme: "nope"`: falls back to Clean Office with a warning.

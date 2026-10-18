# Plan: User themes (spec 040)

## Approach
1. **Shared validation** (`src/shared/themes.ts`): caps and manifest shape checks used by main and by tests (renderer keeps its own JS validator, both feed the same rules — tests pin the contract).
2. **Main** (`src/main/themes.ts`): scan/get/import/export around `userData/themes`; no symlinks (copy only regular files), atomic-ish copy into a temp name then rename.
3. **IPC/preload**: `theme:listUser`, `theme:getUser`, `theme:import`, `theme:export` (+ `dialog.showOpenDialog`/`showSaveDialog` for folder picks).
4. **Renderer**: screens.js Theme section gains the user list + Import/Export buttons; app.js applies user manifests at startup (resolve id → built-in, else `theme:getUser`).

## Files changed
- `src/shared/themes.ts`, `src/main/themes.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/screens.js/css`, `src/renderer/app.js` (startup resolution), tests `scripts/test-userthemes.ts`, package `test:` wiring.

## Risks
- File copying edge cases (existing folder, odd names) → refuse overwrites on import (or version suffix), never follow symlinks, `fs.cpSync` with `errorOnExist`-style checks.

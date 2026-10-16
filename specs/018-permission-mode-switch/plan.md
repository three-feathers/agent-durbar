# Plan: 018
- `permissions.ts`: options become `getMode()`; mode changes emit `{type:'mode'}`.
- `copilot.ts`/`main.ts`/`folders.ts`/`api.ts`/`preload.ts`/`sim.ts`: plumb `setPermMode`.
- `app.js`: header chip + menu, card icon + context menu, confirm dialog.

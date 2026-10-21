# Plan 064
1. `dialog.js`: `input.multiline`, `picks`, `need` (generic; unit test in `test-dialog`).
2. `app.js`: `sendLive(text, forId, {fromComposer:false})` leaves the composer alone; `sendToSeveral()` builds the picks from the running main sessions (idle ones enabled), the palette action and the ⋯ menu item.
3. CSS for the pick list (inside the existing `.dlg` styles; 10.5px+).
4. Driver `scripts/shots-064-send-several.js` at 1440x900 and 1280x800 (simulator); README and CHANGELOG lines; `specs/README` row.

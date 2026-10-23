# Plan: 017
- `roomsummary.js`: `summarizeRoom(states, {subWorking})` -> `{text, tone}`.
- `app.js`: `ROOM.closed` from `AgentInfo.closed`; `officeModel` returns closed rooms flagged; `chooseLayout` sizes only open rooms and reserves a plate row; `roomHTML` closed variant; header button `data-door`.
- `folders.ts`: `closed` flag + `setClosed`; main IPC `folders:setClosed`; preload/api; sim stub.
- styles: `.room.closed`, `.door` animation.

## Plan: 2026-10-23 delta (meeting-room door signs, FR-003..FR-010)
- `roomsummary.js`: pure `doorSign(x)` beside `summarizeRoom`; unit cases and mutation checks in `scripts/test-rooms.ts`.
- `app.js`: `signInput(a)` (from `vis`, `paused`, `coffee`, `limit`, the `Ended` label, `isFailing`, helpers), `signHTML(a, cls)` used where the desk pill and the mini/micro status word are drawn (full desk, card) and in the lounge peek; `doorSvg(open, ink)` gains an ink mode (`currentColor`, same paths); `SIGN_PREF` in `localStorage` (`durbar.doorsigns`), like `SHUT_PREF`.
- `screens.js`: a Settings > Detail level switch next to the lounge switch (`X.signs`).
- `styles.css`: `.dsign` (glyph sizes, filled plate in the tone's `--pb-*`, dashed edge for Away); no colour literals (spec 070 ratchet), only existing tokens.
- Tests first: `scripts/shots-017-signs.js` (simulator, in `ui-suite.js`): mixed states set through `__durbarSimUi` (paused, coffee, ended, a helper at work), each sign's key, word, icon and tone; contrast in all 6 themes; min font; no overlap and no office scroll at 1440x900 and 1280x800; the switch off restores the plain words; mutation check by hand (break the mapping, see it fail).
- Drivers that read the desk pill's text (`shots-052-ux` Sven "Failing", `shots-034` limit) are updated to read the sign or the accessible name.

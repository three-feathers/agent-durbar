# Plan: 017
- `roomsummary.js`: `summarizeRoom(states, {subWorking})` -> `{text, tone}`.
- `app.js`: `ROOM.closed` from `AgentInfo.closed`; `officeModel` returns closed rooms flagged; `chooseLayout` sizes only open rooms and reserves a plate row; `roomHTML` closed variant; header button `data-door`.
- `folders.ts`: `closed` flag + `setClosed`; main IPC `folders:setClosed`; preload/api; sim stub.
- styles: `.room.closed`, `.door` animation.

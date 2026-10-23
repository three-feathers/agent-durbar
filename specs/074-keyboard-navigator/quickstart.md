# Quickstart: check the keyboard navigator

Zero AI credits: simulator and unit tests only.

```bash
npm run build
nice -n 19 npm test -- navigator              # unit tests: levels, parsing, numbers, shortcut, clash list
OUT=docs/screenshots DURBAR_USER_DATA=$(mktemp -d) DURBAR_SIM=15 DURBAR_SIM_FREEZE=1 DURBAR_SIM_FLOORS=1 \
  DURBAR_DRIVER=$PWD/scripts/shots-074-navigator.js nice -n 19 xvfb-run -a npx electron . --no-sandbox
# or: node scripts/ui-suite.js --only shots-074-navigator
```

The driver (`DURBAR_SIM=15`, with floors) checks and screenshots at 1440x900 and 1280x800:

1. Ctrl+J (⌘J on a Mac) opens the palette in Go-to mode at the floor level; `2` picks floor 2; typing filters folders; Enter; `1` opens an agent; the message box has focus; typing and Enter puts the message in that chat.
2. Ctrl+J, `c`, `3`: chat 3 opens with focus in the message box; its header shows "C3".
3. Esc chain: floor → folder → agent level, then Esc, Esc, Esc closes and focus returns.
4. Settings > Keyboard: change to Ctrl+Shift+G; Ctrl+J no longer opens it, Ctrl+Shift+G does; Ctrl+K is refused with a reason; Reset restores Ctrl+J.
5. Every new text ≥ 10.5px; the office with badges has no overlap (`check-office-overlap`).

Screenshots: `docs/screenshots/074-navigator-*`.

# Quickstart 072 (simulator, no credits)

1. `npm run build && DURBAR_SIM=15 npm start`, open any chat.
2. Type `/` in the message box: the list opens above it with folder, user and (Claude chats) app entries, at most 8 rows.
3. Type `re`: the list narrows; ArrowDown, then Tab: `/<name> ` is in the box. Esc with the list open closes only the list.
4. Add words and press Enter: the user message shows what you typed, with the note "Sent the text of …" for a folder entry.
5. Automated: `npm run check:slash-suggest` (keyboard flow, ARIA, geometry at 1440x900 and 1280x800, screenshots to `OUT`).
6. Unit: `npm run test:slashcommands` (discovery, caps, symlinks, expansion, places per app) and `npm run test:runtime` (holds the adapter contract test).

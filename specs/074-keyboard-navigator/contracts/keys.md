# UI contract: navigator keys

| Where | Key | Effect |
| --- | --- | --- |
| anywhere (no other modal dialog) | navigator shortcut (default Ctrl+J, ⌘J) | open the navigator at the start level; again: close |
| Ctrl+K palette | navigator shortcut, or the "Go to… (navigator)" action | switch to the navigator's start level |
| navigator | letters | filter the current level |
| navigator, start level | `f` Space / `c` Space | Folders / Chats level |
| navigator, start level | `c` then digits (`c3`, `c 3`) | open that chat (when unique; else highlight, Enter opens) |
| navigator, any level | digits only | pick by shown number (unique: at once; else Enter) |
| navigator | ↑ ↓, Ctrl+Home / Ctrl+End | move |
| navigator | Enter | pick |
| navigator | Esc, or Backspace on an empty filter | back one level; closes at the start level |
| navigator | Tab | stays in the input |
| chat opened by the navigator | Enter in the message box | send (existing composer) |

The module `src/renderer/navigator.js` exposes (Node and `window.DurbarNav`):
`rank(items, q)`, `parseStart(q)`, `pickNumber(items, digits)`, `levelItems(snapshot, level)`, `assignNumbers(map, ids)`, `pruneNumbers(map, ids)`, `loadNumbers(json)`, `DEFAULT_COMBO`, `comboFromEvent(e, mac)`, `comboMatches(e, combo, mac)`, `comboParts(combo)`, `clashOf(combo, mac)`, `loadCombo(json)`.

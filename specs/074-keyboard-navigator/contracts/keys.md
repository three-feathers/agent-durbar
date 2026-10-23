# UI contract: navigator keys

| Where | Key | Effect |
| --- | --- | --- |
| anywhere (no other modal dialog) | navigator shortcut (default Ctrl+F, ⌘F; Ctrl+J, ⌘J until 2026-10-23) | open the navigator at the start level; again: close |
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
| any chat with an unsent draft, not open | | a pencil on its desk, list row and strip item, "Unsent draft" (FR-024) |
| any chat the user opens (desk, list row, strip, Ctrl+K, navigator, Needs you, Ctrl+`; not N / next agent, which focuses the title) | | the cursor at the end of the message box (its unsent text restored); never the answer bar; no box: the chat title |
| outside text (no editable field focused, nothing selected, no dialog) | Ctrl+A / ⌘A | open Needs you (not in the chat log) |
| outside text, a chat or the VS Code view open | Ctrl+Backspace / ⌘⌫ | back to the office (the chat's unsent text and attachments are kept, FR-022) |
| in an editable field, with a selection, in a dialog | Ctrl+A, Ctrl+Backspace | the field's own select all / delete; nothing else |

The module `src/renderer/navigator.js` exposes (Node and `window.DurbarNav`):
`rank(items, q)`, `parseStart(q)`, `pickNumber(items, digits)`, `levelItems(snapshot, level)`, `assignNumbers(map, ids)`, `pruneNumbers(map, ids)`, `loadNumbers(json)`, `DEFAULT_COMBO`, `comboFromEvent(e, mac)`, `comboMatches(e, combo, mac)`, `comboParts(combo)`, `clashOf(combo, mac)`, `loadCombo(json)`, `takenBy(combo, mac)`, `textSafeKey(e, mac, ctx)` (2026-10-23).

# Data model: Keyboard navigator

All in the renderer; nothing crosses IPC.

## Snapshot (input to the level logic)

Built by `app.js` from what the office shows (floors that are on, folders not hidden, main sessions):

- `floors: [{id, name}]` in floor order (only floors that are on)
- `folders: [{id, name, floor, hint}]` in office order
- `chats: [{id, name, folder, no, hint}]` main sessions, `no` = chat number

## Level

`{kind: 'start'|'folders'|'agents'|'chats', floor?: id, folder?: id, q: string, active: number}`

The navigator state is a stack of levels (`start` at the bottom). Transitions:

| From | Event | To |
| --- | --- | --- |
| start | pick floor | folders (floor) |
| start | pick folder (one floor on) / folders level pick | agents (folder), or **open** when the folder has one session |
| start | `f ` or the Folders row | folders (all) |
| start | `c ` or the Chats row | chats |
| start | `c<digits>` unique | **open** chat |
| agents / chats | pick | **open** |
| any but start | Escape, Backspace on empty `q` | the level below in the stack |
| start | Escape | **close** |

Items carry `n` (shown number): position 1.. at start/folders/agents, chat number at chats.

## Chat numbers

`{[sessionId]: number}`; numbers unique, ≥ 1. `assign(map, ids)` gives each id without a number the lowest free one; `prune(map, ids)` drops ids not in `ids`. Saved as JSON under `durbar.chatNo` (at most 500 entries; invalid entries dropped on load).

## Shortcut combo

`{mod: bool, ctrl: bool, alt: bool, shift: bool, code: string}`; `mod` = ⌘ on a Mac and Ctrl elsewhere; `ctrl` = the Control key on a Mac only. Valid when `code` is `Key[A-Z]`, `Digit[0-9]`, `F1`-`F12`, `Space`, or punctuation codes, and at least `mod`, `ctrl` or `alt` is set. Saved as JSON under `durbar.navKey`. Default `{mod:true, code:'KeyJ'}`.

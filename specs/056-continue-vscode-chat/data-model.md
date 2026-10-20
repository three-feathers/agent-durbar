# Data model: Continue a VS Code chat in Durbar (spec 056)

Nothing new is saved to disk. All shapes below live in memory and cross the IPC boundary; chat text in them is already redacted. No vendor types (constitution II).

## Reader additions (`src/adapters/vscodeChat.ts`)

- `ChatStore.folder?: string`, `ChatStore.workspace?: string`: the path from the store's `workspace.json` that matched (already computed in `findChatStores`, not kept today).
- `ChatFileRef.folder?: string`: copied from its store, so the draft header can name the folder the chat belonged to.
- `VsChatBlock` `tool` variant gains `file?: string`: the base name of an edited file (`textEditGroup`), so "files touched" does not parse labels. The view ignores it (spec 009 unchanged).

## ContextTurn (pure, `src/shared/chatcontext.ts`)

| Field | Type | Notes |
| --- | --- | --- |
| `index` | number | 0-based position among the transcript's turns (stable for one read). |
| `ts` | number? | The user request's timestamp when VS Code saved one. |
| `user` | string | User text, attachments as `[attached: name]`. |
| `answer` | string | Assistant texts, `[tool: …]`, `[edited: …]`, `[note: …]` lines, in order. |
| `files` | string[] | Edited file names and attachment names of this turn. |
| `tokens` | number | `ceil(chars/4)` of the turn as it appears in the draft (after per-text cuts). |
| `preview` | string | First line of the user text, at most 120 characters, for the picker. |

A turn starts at each `user` block; blocks before the first `user` block form a turn with an empty user text. Each text is cut at 8,000 characters (`[… N characters cut]`); at most 20 tool lines per turn.

## DraftRequest (renderer → main, `vschat:draft`)

| Field | Type | Validation in main |
| --- | --- | --- |
| `id` | string | A known agent id. |
| `key` | string | Must be in `vsChatRefs.get(id)` (spec 009 FR-006). |
| `select` | `'fit'` \| `'all'` \| number[] | `'fit'` default; an array of at most 300 distinct integers in range, anything else is dropped. |
| `contextWindow` | number? | The chosen model's window when the renderer knows it; positive integer ≤ 10,000,000, else ignored. |

## ContextDraft (main → renderer)

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | `false` with `error` when the chat cannot be read or the agent is gone. |
| `title` | string | The chat's title (redacted). |
| `turns` | `{ index, ts?, preview, tokens, included }[]` | For the picker; no full texts besides `text`. |
| `text` | string | The whole first message (header, quoted turns, closing line), redacted. |
| `tokens` | number | Estimate for `text`. |
| `cap` | number | 30,000. |
| `left` | number | Turns left out by the default selection (0 when the user chose). |
| `masked` | number | How many replacements `redact()` made (count only). |
| `notes` | string[] | The reader's notes (unknown kinds, truncation, format version). |
| `tooBig` | boolean | `tokens` > half of `contextWindow` when one was given (FR-008). |

## FinalizeResult (main → renderer, `vschat:finalize(text)`)

| Field | Type | Notes |
| --- | --- | --- |
| `ok` | boolean | `false` for a non-string, an empty text or more than 400,000 characters. |
| `text` | string | `redact(text)`. |
| `changed` | boolean | `true` when redaction changed it: the renderer shows `text` again and does **not** start (FR-010). |
| `tokens` | number | Estimate for `text`. |

## Estimate line (pure, renderer `src/renderer/modelswitch.js`)

`contextCostLine(tokens, caps, model, cap, simple)` → `{ size: string, cost: string, overLimit: boolean }`: one unit chosen from `caps.capUnit` and `caps.usage` (AIU, dollars or tokens), a figure only from `estimateInputCredits` (which already refuses unverified prices), never two units in one line.

## State transitions

`view or row` → **Options dialog** (Cancel ends) → *Next* → `vschat:draft` → **Review box** (Cancel/Escape ends; picker → `vschat:draft` again; edits stay local) → *Start* → `vschat:finalize` → changed? back to **Review box** with the masked text : `agents:newSession` → `sendLive(text)` → **New chat** with the "Started from a copy…" note.

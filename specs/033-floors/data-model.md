# Data model: 033 floors

## Floor

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | `ground` for the built-in floor; others `f-` + 8 lowercase hex/alnum chars, generated on create, never reused in the same file. Max 40 floors (extra entries dropped on parse). |
| `name` | string | Trimmed, 1 to 40 characters, no control characters. Unique ignoring case. Default for `ground`: "Ground floor". |
| `on` | boolean | Default `true`. |

Order = position in the `floors` array. `ground` is always present (re-added at position 0 if missing or damaged).

## Folder entry (existing `SavedFolder`, spec 006) — new fields

| Field | Type | Rules |
| --- | --- | --- |
| `floor` | string, optional | A floor id. Missing or unknown id → the folder is on `ground`. Not written when it is `ground`. |

All other fields (`workspace`, `permMode`, `hidden`, `closed`, `model`, `effort`, `contextTier`, `maxAiCredits`) are unchanged and are never modified by floor operations (FR-005).

## File `durbar-folders.json` (version 1, additive)

```json
{
  "version": 1,
  "floors": [
    { "id": "ground", "name": "Ground floor", "on": true },
    { "id": "f-3k9x2m1a", "name": "Client A", "on": false }
  ],
  "lastFloor": "f-3k9x2m1a",
  "folders": [
    { "workspace": "/work/api", "permMode": "read-only", "hidden": false, "floor": "f-3k9x2m1a" }
  ]
}
```

A file without `floors` (every file written before this feature) parses as one `ground` floor, on, with every folder on it. No secrets: names, ids, on/off and the folder paths already stored (FR-015).

## Operations and their effects

| Operation | Effect | Refused when |
| --- | --- | --- |
| create(name) | appends `{id, name, on:true}` | name invalid or taken; 40 floors exist |
| rename(id, name) | sets name | id unknown; name invalid or taken by another floor |
| reorder(ids) | reorders to the given full list of ids | list is not a permutation of current ids |
| delete(id) | removes the floor; its folders lose `floor` (→ `ground`); `lastFloor` reset to `ground` if it pointed there | id is `ground` or unknown |
| setOn(id, on) | sets `on` | id unknown |
| only(id) | that floor `on:true`, all others `on:false` | id unknown |
| moveFolder(workspace, id) | sets the folder's `floor` (`ground` clears it) | folder or floor unknown |
| add folder with floor | new entry gets `floor`; `lastFloor` = that id | unknown id → `ground` (not an error) |

No operation pauses, stops, ends or resumes a session (FR-009, FR-010, SC-006).

## Renderer room (existing `ROOMS` entry) — new field

`floor`: floor id from `AgentInfo.floor`. Derived predicate: `roomShown(r) = !r.hidden && floor(r.floor).on` (demo mode: always on).

## State transitions of a floor

`on` ⇄ `off` by switch or Only. Deleting a floor in either state moves its folders to `ground` with their current visibility following `ground`'s state.

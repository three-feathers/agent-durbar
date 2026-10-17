# Contract: floors over the preload bridge (renderer ⇄ main)

All calls are validated in main (constitution III): ids and names are re-checked with `src/shared/floors.ts`; folders are addressed by an **agent id** (main resolves the folder key, as `folders:setHidden` does today), never by a path from the renderer. The simulator bridge (`sim.ts`) implements the same methods in memory.

## Types (`src/shared/api.ts`)

```ts
interface FloorView { id: string; name: string; on: boolean; ground: boolean }
interface FloorsState { floors: FloorView[]; lastFloor: string; byAgent: Record<string, string> } // agent id -> floor id
type FloorsResult = { ok: true; state: FloorsState } | { ok: false; error: string; state: FloorsState };
```

`AgentInfo` gains `floor?: string` (absent = `ground`), set on `agent:added` and restore.

## Methods (`DurbarApi`, all optional so older bridges degrade to "no floors")

| Bridge method | IPC channel | Arguments | Notes |
| --- | --- | --- | --- |
| `floorsState()` | `floors:state` | — | Current state. |
| `createFloor(name)` | `floors:create` | string | Error text: "Name is empty", "A floor with that name exists", "Too many floors". |
| `renameFloor(id, name)` | `floors:rename` | string, string | Same name errors; "Unknown floor". |
| `reorderFloors(ids)` | `floors:reorder` | string[] | Must be a permutation. |
| `deleteFloor(id)` | `floors:delete` | string | Refused for `ground`. Folders move to `ground`; no session is touched. |
| `setFloorOn(id, on)` | `floors:setOn` | string, boolean | |
| `onlyFloor(id)` | `floors:only` | string | |
| `moveFolderToFloor(agentId, floorId)` | `floors:moveFolder` | string, string | Applies to every agent of that folder (same key rule as Hide). |

`addFolder(permMode, opts)` and `addWorkspaceFile(permMode, opts)`: `opts.floor?: string` (unknown → `ground`); main stores it on the new folder entry and as `lastFloor`.

Every mutating call returns `FloorsResult` with the full new state; the renderer replaces its copy and re-renders (no partial patches). There is no push event: floors only change through these calls in this window.

## Renderer rules bound to this contract

- `roomShown(r)` = not hidden and its floor `on`; used by office, list, folder filter, strip, attention order, status pills and lobby visitors.
- Floor tag in room headers and door plates only when two or more floors are `on`.
- When the open chat's agent ends up on an off floor after a call, close the chat.
- Office usage total: sum of all rooms; tooltip line for the part on off floors.

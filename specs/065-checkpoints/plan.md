# Plan 065

1. `src/adapters/types.ts`: `WriteGuard` type and `AgentAdapter.writeGuard?`; `router.setWriteGuard` fans it out like `setDebug`.
2. `PermissionBroker`: `beforeWrite` option, awaited (2 s cap) when a `write` is approved (Allow all, a session grant, or the user's approval); `PermissionLike.paths` for several files (Codex file changes).
3. Adapters: Copilot and Codex pass `beforeWrite` to their broker (Copilot's `fileName`, Codex's change paths); Claude calls the guard from the `PreToolUse` hook for write tools when the decision allows the call.
4. `src/main/checkpoints.ts` (`CheckpointStore`, pure fs with injected dir/limits, unit-tested), wired in `main.ts`: guard → `capture` (resolving relative paths against the session's folder), `sendOp` → `beginTurn`, status idle/stopped → `endTurn` → `agents:checkpoint` to the window; IPC `agents:checkpointPreview`, `agents:checkpointUndo`; `agents:remove` → `forget`.
5. Renderer: the note line after the turn, the preview dialog (shared `askDialog`), the result note with "Undo the undo"; preload + `api.ts`; simulator bridge.
6. Tests: `scripts/test-checkpoints.ts` (symlinks, outside paths, changed-since, created/deleted files, binary, large, limits, undo-of-undo, atomic write), broker test for `beforeWrite`; driver `scripts/check-checkpoints.js`; one real check on Claude Code (a tiny edit, then undo).

# Feature Specification: Undo an agent's file changes (checkpoints per turn)

**Feature Branch**: `065-checkpoints`
**Created**: 2026-10-21
**Status**: Built (unit tests, simulator driver, one real check); see `## Changes`.
**Input**: Issue #431, from the overnight evolution research (2026-10-21). Owner (Vikram, terminal, 2026-10-21): "go ahead with those features".

## Why

After an agent's turn the first question is often "what did it change?" (spec 063 folder status answers that), and the second is "put it back". Today the only way back is the user's own git or editor. This feature lets the user undo the file changes of one turn, safely.

## Safety first (constitution III)

Writing to the user's files is the risky part, so the rules are strict:

- **Only what the agent changed, only in its folders.** Durbar keeps a copy of a file just before the agent's file-edit tool writes it, and only for paths inside the session's folders (realpath containment). A symbolic link is never followed and never restored. Durbar never touches a file the agent did not change in that turn.
- **Never over someone else's work.** When the turn ends, Durbar records what each changed file looks like (a hash). An undo refuses, for the whole turn, when any of those files changed since (by the user, another session or a later turn): the dialog names the files and nothing is written.
- **Always confirmed, always previewed.** An undo starts from "Undo these changes…" on the turn's note in the chat, and opens a dialog that lists exactly which files will be restored, created back or removed, with a short diff of each. Nothing is written before the user presses **Restore**.
- **Undo the undo.** Before restoring, Durbar keeps a copy of the current files, so the restore itself can be undone the same way.
- **No git commands, no shell.** Durbar reads and writes the files itself (copy and atomic rename); it never runs git or a shell to restore.
- **Private and bounded.** Copies live under the app's user data folder (`checkpoints/`, folders 0700, files 0600), at most 5 MB per file and 50 MB per turn; the last 20 turns per session are kept; a removed session's copies are deleted.

## What is covered

Changes made through the agent apps' **file-edit tools**, captured at the moment the agent app asks Durbar before the write (all of these run before the file is written and are awaited):

| Agent app | Where Durbar sees the write first | Modes |
|---|---|---|
| Claude Code | the `PreToolUse` hook (Edit, Write, MultiEdit, NotebookEdit) | every mode |
| Copilot | the permission request for a `write` (the broker answers it) | Ask first and Allow all (Read-only denies writes) |
| Codex | the file-change approval request | Ask first; **not Allow all** (Codex asks nothing there) |

Not covered, said in the dialog and the README: files changed by shell commands (`sed -i`, `rm`, a build), by MCP tools, by Codex in Allow all, or outside the session's folders.

## Requirements

- **FR-001** An adapter-neutral write guard: adapters call `writeGuard(sessionId, paths)` before approving a file-edit write and wait for it (bounded, never fails the write). Copilot and Codex through the permission broker (`BrokerOptions.beforeWrite`), Claude Code through its `PreToolUse` hook for write tools in every mode.
- **FR-002** `CheckpointStore` (main): `beginTurn(agent)` at each send (`sendOp`, so scheduled prompts too), `capture(agent, roots, path)` keeps the first copy of a path in the turn (or "did not exist"), `endTurn(agent)` when the session goes idle or stops records the after-hash of each file and returns a summary (files changed, created, deleted; files not covered and why).
- **FR-003** When a turn changed files, the chat shows one muted line after the turn: "Changed N files in this turn." with **Undo these changes…** (only then; no line for turns without captured changes).
- **FR-004** `preview(agent, turn)`: per file the action (restore / remove the file the agent created / create back the file the agent deleted), a short diff (text) or "binary file", and the conflicts (files changed since the turn ended). `undo(agent, turn)`: refuses with the conflict list if any; otherwise saves the current files as a new checkpoint (the undo of the undo), then restores each file atomically (temp file + rename, mode kept) or removes the created file; returns what was done and the new checkpoint's id.
- **FR-005** IPC from Durbar's own window only (`fromApp`), never from MCP, remote control or schedules; ids and turn numbers validated in main; paths never come from the window.
- **FR-006** Limits: 5 MB per file and 50 MB per turn (larger files are listed as "too large to undo"), 20 turns per session, copies deleted when a session is removed or the store is over its total cap (500 MB, oldest first).
- **FR-007** Simulator: `simcheckpoint=1` gives one agent a turn with changed files, a preview with a diff and a conflict variant, and an undo that returns an "undo the undo" line; a driver with screenshots at 1440x900 and 1280x800.

## Out of scope

Native rewind features (Claude Code's checkpoints / rewind, any Copilot snapshot): researched, not used yet, because one Durbar-side mechanism behaves the same for every agent app and covers Copilot, which has none; revisit when they are exposed to SDK clients in a documented way (`[KNOWN GAP]`).

## Changes

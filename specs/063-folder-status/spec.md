# Feature Specification: Folder status in the chat (git branch and changed files)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 046
title: Folder status in the chat: git branch and uncommitted changes on the folder chip, a click lists the changed files (read-only)
status: **built** 2026-10-21: unit tests, simulator driver and screenshots, one real check on Linux
-->

**Feature Branch**: `063-folder-status`
**Created**: 2026-10-21
**Status**: Built (simulator, unit tests, one real check on this repository).
**Input**: Overnight owner request (2026-10-20): "research what could come as natural evolution and autonomously implement new features which make sense the way we are evolving without making app messy or clumsy". Research: `evolution.md` idea 1, "what did my agent change, and on which branch?" is the first question after a turn, and Durbar does not answer it today.

## User Scenarios

### Story 1 - See the branch and the changes at a glance (P1)
In a chat, the folder chip in the header also shows the git branch and how many files have uncommitted changes, for example `~/work/api · main · 3 changed`. Nothing changes for a folder that is not a git repository, or when git is not installed.

### Story 2 - See which files changed (P1)
Clicking the folder chip, when it shows changes, opens a small dialog: the branch (and ahead/behind of its upstream), then each changed file with its state (modified, added, deleted, renamed, untracked) and its +/− line counts. Buttons: **Open in VS Code** (the existing action) and **Done**.

### Story 3 - It stays current without noise (P2)
The status is read when the chat opens and again when the agent finishes a turn (it goes idle), at most once every 5 seconds per folder. There is no polling while nothing happens.

## Requirements

- **FR-001** Main reads the status only for a folder Durbar already knows (the agent's own `cwd`; the renderer passes an agent id, never a path). It runs `git` with argv only (no shell):
  - `git -C <dir> status --porcelain=v1 --branch -z --untracked-files=all`;
  - `git -C <dir> diff HEAD --numstat -z` for the line counts.

  Limits: 4 s per command, 512 KB of output, 200 files listed (with "and N more"). Read-only: no git command that writes (no `fetch`, no lock-taking commands; `--no-optional-locks` is passed).
- **FR-002** The result is `{ repo: false }`, or `{ repo: true, branch, detached?, ahead?, behind?, files: [{ path, state, added?, removed? }], more }`. Paths are relative to the repository, at most 300 characters, with control characters removed. On any error, `{ repo: false }`: the chip simply shows nothing extra.
- **FR-003** The folder chip shows ` · <branch>` (or ` · detached`) and, when files changed, ` · N changed`. The chip becomes a button only when there is something to show; its accessible name says the same. The text is at least 10.5px and the chip still fits (it truncates the path first, as today).
- **FR-004** The dialog uses the shared dialog (`askDialog`). Lines are text only (never HTML):
  - `M  src/app.ts  +12 −3`, using A/D/R/? for added, deleted, renamed and untracked;
  - binary files say "binary";
  - the body says the branch and ahead/behind.
- **FR-005** Refresh: on chat open and on each turn end, debounced to 5 s per agent. One request in flight per agent. Nothing runs for a sub-agent's helper chat (it uses its parent's folder).
- **FR-006** Simulator: agents report a fixed status (branch `main` or `feature/login`, 0–4 changed files), so the driver and screenshots need no git repo.
- **FR-007** Windows, macOS and Linux: `git` is found on PATH with the existing detection (no hard-coded path); `-z` output avoids quoting differences.

## Out of scope
Committing, staging, discarding or diffs inside Durbar (VS Code does this). Status of folders without an open chat.

## Changes

### 2026-10-21: built
- `test:` `scripts/test-gitstatus.ts` (in `npm test`) covers:
  - parsing of porcelain v1 `-z` (upstream, ahead/behind, renames, untracked, conflicts, detached, no commits yet) and of numstat `-z` (binary, renames);
  - the read-only argv (`--no-optional-locks`, no writing subcommand), the 200-file cap, and failures giving `{ repo: false }`;
  - the window's words.
- `sim:` `scripts/shots-063-folder-status.js` at 1440x900 and 1280x800:
  - a folder with 3 changes: the chip says "· main · 3 changed", is a button, is at least 10.5px and fits the header; the dialog is titled with the folder name, lists the files in plain words ("changed", "new", "deleted") and has Open in VS Code and Done;
  - a clean repository shows the branch only, and is not a button;
  - a folder that is not a repository is unchanged.
  - Screenshots: `docs/screenshots/063-folder-*`.
- `real:` 2026-10-21, Linux: `folderGitStatus` on this repository's worktree listed the branch and all 11 changed files with their line counts; `/tmp` gave `{ repo: false }`.
- Wording decision: plain words instead of git's one-letter codes (M/A/D/?), for people who do not use git.
- `[KNOWN GAP]`: not run by hand on macOS or Windows (`git` from PATH, `-z` output, argv only, so nothing OS-specific is expected); a very large repository is bounded by the 4 s and 512 KB limits but was not timed.

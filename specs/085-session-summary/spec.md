# Feature Specification: End-of-session summary card

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: End-of-session summary card in the chat: files changed, +/- lines, commits, duration, cost from Durbar's own measurements (issue #604)
status: **built** 2026-10-25 for the chat card (unit tests, simulator driver); lounge bubble, briefing and vendor numbers are known gaps
-->

**Feature Branch**: `085-session-summary`
**Created**: 2026-10-25
**Status**: Built 2026-10-25 for the chat card; see `## Changes`.
**Input**: Issue #604 (owner go, Vikram, Telegram DM, 2026-10-23). Related: spec 063 (git status of a folder), spec 065 (checkpoints), spec 057 (briefing actions), the usage totals and cost table (specs 011, 052).

## Why

When a session ends the first questions are "what did it do" and "what did it cost". Durbar already knows the cost and the time, and git knows the files. One short card in the chat answers both, with no vendor numbers to trust.

## Scope of this spec

The card appears **in the chat when the user ends a session** (End session from the chat header, the card menu or More; End all sessions shows one card per ended chat). Not in this spec, kept on issue #604: the card on the lounge bubble, in the daily briefing, and vendor-reported numbers (Copilot `session.shutdown`, Claude Code status line, Codex `notify`). Those are `[KNOWN GAP]`; every number here is **measured by Durbar**, never copied from an agent app.

## Requirements

- **FR-001** From the first message Durbar sends in this run to a session, main remembers a start: the time (monotonic-safe: only a difference is used, never shown as a clock) and, for a git folder, the start commit (`git rev-parse --verify HEAD`, kept only when it is 40 or 64 hex characters) and whether the working tree was clean (`git status --porcelain=v1 -z --untracked-files=normal`, no line counts). The two reads run together. Spec 063's runner reads the folder's filter driver names (`git config`) before each call, so the first message waits for at most two git time limits (8 s); in practice the config read takes milliseconds. The start is stored at once with its pending read, and the summary waits for it, so an End right after the first message never sees a half-read start. Nothing is stored on disk. A session that was never sent a message has no start, so ending it shows no card.
- **FR-002** `agents:sessionSummary(id)` (Durbar's own window only, `fromApp`; the id is checked, the window never passes a path or a ref) answers `{ ok: true, ms, git }`. `git` is `{ repo: false }` for a folder git says is not a repository, `{ repo: false, unreadable: true }` when git could not be read (a time limit, output over the limit, git missing, or git's words in another language), or `{ repo: true, files, added, removed, binary, newFiles, commits, dirtyAtStart, noHead? }`:
  - `files`/`added`/`removed`: `git diff --no-ext-diff --no-textconv --shortstat <start commit> --` (no diff helper configured for the folder runs), tracked files changed since the start, committed and uncommitted together;
  - `newFiles`: untracked files (not ignored) now present, counted only when the tree was clean at the start; their lines are not counted; when they cannot be listed (`newFilesUnknown`) the card says "new files not counted";
  - `commits`: `git rev-list --count <start commit>..HEAD`;
  - `dirtyAtStart`: the folder already had uncommitted changes when the session began, so the counts include them (the card says so);
  - git runs with `execFile` and an argument array (no shell), `--no-optional-locks`, the limits of spec 063 (4 s and 512 KB per git process), output parsed with anchored patterns, every number clamped to a safe integer; the reads of the summary run together (at most two 4 s limits, the runner's config read and the call; the window waits 5 s, so a summary slower than that shows no card); a failure is never shown as "not a git folder" unless git said so, and never as an invented zero. Git runs through spec 063's `nodeGitExec`, which runs no command from the folder's git config (`core.fsmonitor`, diff and textconv helpers, every filter driver; #722, closing [#719](https://github.com/three-feathers/agent-durbar/issues/719)) and allows only the flags in its `GIT_CALLER_OPTIONS`; `test:sessionsummary` runs every call of this spec through that allowlist.
- **FR-003** The card is one muted note in the chat of the ended session, built from numbers only (no file names, so nothing from the repository is shown; the changed-files list is the existing dialog of spec 063): for example "Session summary: 12 files changed, +340 −80, 3 new files, 1 commit, 25 min, cost ≈ $0.40."; the cost is "cost " and the existing usage figure of that session (`costText`; "N tokens" for an agent app without a price), or "cost not reported"; Simple mode shows money only, no token counts. A non-git folder says "not a git folder, so files and lines are not counted"; a folder git could not be read in says "could not read git in the folder, so files and lines are not counted". A folder that already had changes ends with "The folder already had changes when the session began; they are counted too." A button **Show uncommitted changes** opens the existing folder-changes dialog (spec 063) from a fresh `gitStatus`: it lists only what is not committed yet, said in the tooltip; with nothing uncommitted it says so, and that what the session committed is in the folder's git history.
- **FR-004** Pull requests: shown only when the adapter reports them (`pullRequests` on the summary, from an adapter that sees the PR link in a tool result it controls). No adapter reports them today, so the card says nothing about PRs; it never guesses from commit messages or branch names. `[KNOWN GAP]`
- **FR-005** Honest numbers: "estimated" where the cost is Claude's estimate (existing wording), "not reported" where there is none; commit and file counts are Durbar's own reading of git, said in the tooltip; files changed by other tools or people in the same folder during the session are counted too (said in the tooltip).
- **FR-006** All text is masked and escaped: every number is coerced to a bounded integer, the only text taken from outside is nothing; the card is built with `textContent`/escaped HTML, and a hostile summary object (strings for numbers, huge numbers, extra keys, `__proto__`) shows as zeros or nothing.
- **FR-007** Simulator: `simsummary=1` gives each ended sim session a fixed summary (a repo with changes and a commit and a reported PR for the first agent, a non-git folder for another, a dirty-at-start folder for a third). Driver `scripts/check-session-summary.js` (until(), 1440x900 and 1280x800; the first card's cost must be that session's own usage figure, and the card must be open, non-zero in size and on top inside the window before the screenshot). Unit tests `scripts/test-sessionsummary.ts`.

## Out of scope

Lounge bubble and daily briefing placement; vendor-reported numbers (Copilot `session.shutdown`, Claude Code status line/OTel, Codex `notify`); a card when the agent finishes but the session stays open; PRs from adapters; line counts of untracked files.

## Changes

### 2026-10-25: built (T001-T005)

- **FR-001/FR-002** `[IMPLEMENTED]` `src/main/sessionsummary.ts` (`SessionStarts`, `parseShortstat`, `parseCount`, `validRef`, `countBinary`); `agents:send` notes the start before the first turn, `agents:sessionSummary` (window only), `agents:end` and `agents:remove` forget it. `test:` `scripts/test-sessionsummary.ts`: hostile shortstat and count text, every diff against the start commit with `--no-ext-diff --no-textconv`, a hostile `rev-parse` answer never reaching an argument, read-only argv, not a repository versus could not read (a time limit at the start and at the end, output over the limit), an End while the start is still being read, the start reads run together and use no line counts, a dirty start, a start with only untracked files (dirty, no new files), no start, one start per session. `scripts/test-ipcchannels.ts`: the start is noted before `sendOp`, `agents:sessionSummary` takes only the id and uses main's own folder, `agents:end` and `agents:remove` forget the start.
- **FR-003/FR-005/FR-006** `[IMPLEMENTED]` `src/renderer/sessionsummary.js` (words; numbers coerced and clamped, cost text cut), the note and **Show uncommitted changes** in `app.js` (`endLive`, the card menu's End and End all sessions); the summary is asked before the end (5 s limit; End all sessions asks for all of them together, so it waits at most 5 s in all) and shown after it. `sim:` driver for End session in More; End all sessions shares the code and is `read:` only.
- **FR-004** `[KNOWN GAP]` no adapter reports pull requests, so a real session never shows one; the simulator fixture (`sim-1`) shows the line for the day one does. Not guessed from commit messages or branch names.
- **FR-007** `[IMPLEMENTED]` `simsummary=1`, `scripts/check-session-summary.js` (in `scripts/ui-suite.js`; 1440x900 and 1280x800, `until()` waits).
- `[KNOWN GAP]` untracked files are counted but their lines are not; a folder with no commit at the start counts no files or lines; a session resumed after a restart counts from its first message in this run; changes by other tools or people in the same folder count too (said in the tooltip); the end of a session by quitting the app or by Remove from office shows no card; spec 063's runner switches every filter driver off (git-lfs, git-crypt), so a touched file such a filter stores differently can count as changed (with its lines) although plain `git diff` shows nothing; a summary git takes more than 5 s to read shows no card; Windows and macOS were not run by hand (CI drivers only).
- Not in this spec, still on issue #604: the lounge bubble, the daily briefing and the vendor-reported numbers (Copilot `session.shutdown`, Claude Code status line, Codex `notify`).

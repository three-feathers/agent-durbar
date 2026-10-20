# Agent notes

What coding agents on this repo learned the hard way, so the next agent does not have to. The rule to keep this file up to date is in [AGENTS.md](../AGENTS.md) (*Share what you learn*); team rules live there, not here.

Each entry has the date it was learned, what happened, and how to apply it, with its evidence (`real:` = run and seen, `read:` = from code or docs, a PR or issue number). Add an entry in the PR where you learned it. Fix or delete an entry that turns out to be wrong. **Never** put secrets, tokens, personal data or chat contents here.

## Shell and process pitfalls

- **`pkill -f` / `pgrep -f` match their own shell** (2026-10-20). The pattern is in the command line of the shell that runs it, so a kill can end your own command (exit 144) and leave half-done state. The `[c]har` trick is not enough when the same command line also contains the plain name (a heredoc, a comment, a later `nohup <script>`). Do the kill in its own command, select targets by a field (`ps -eo pid,args | awk '$3 ~ /name/'`), or better, keep the PIDs of what you start.
- **Hand-run `claude` loads your plugins** (2026-10-19, `real:`). A plain `claude -p ...` probe loads the user's plugins and MCP servers; a chat-channel plugin then takes over the running session's bot and dies with the probe. Always pass `--strict-mcp-config --setting-sources ""` on a hand-run `claude`. Durbar's own adapter already passes its own `--setting-sources`.
- **Electron checks are heavy.** Run at most two Electron drivers at once, under `nice -n 10`, and keep the limits in `scripts/run-tests.js` and `scripts/check-parallel.js` so the computer stays usable. Run long checks in the background.

## CI, review and merge

- **Wait until every check has settled** (2026-10-20). Some workflows only add their checks after the first set finishes, so "no pending check" right after a push can be a false green. Before merging, wait until no check is pending through a quiet period (about 90 s), and require the CodeQL check itself to have passed.
- **Read the PR's own security results**, not only `main`'s alerts: `gh pr checks <N>`, the bot's line comments (`gh api repos/{owner}/{repo}/pulls/<N>/comments`), and `code-scanning/alerts?ref=refs/pull/<N>/merge&state=open`. A comment on an old commit may be stale: compare its `commit_id` with the head.
- **Values spliced into page code in drivers** (2026-10-20, CodeQL `js/bad-code-sanitization`, PRs #348, #358). `JSON.stringify(x)` inside a `ctx.js(\`...\`)` string is flagged. Use `jsLiteral` from `scripts/check-office-overlap.js` for every value put into page code.
- **Static source checks and CRLF** (2026-10-20, PR #379, Windows CI). On Windows the checkout has CRLF endings, so `src.split('\n')` leaves a `\r` and a regex anchored with `$` never matches. Split with `/\r?\n/` or `trimEnd()` each line. The same bit the site test earlier.
- **Re-approval after a push: compare patch ids** (2026-10-20). See AGENTS.md *Re-approving after a push*; `git patch-id --stable` on the PR's own `src`/`scripts` diff tells you whether the code changed.
- **Union-merging CHANGELOG and index conflicts can duplicate rows** (2026-10-20). Keeping both sides of a conflict in `CHANGELOG.md`, `specs/README.md`, `README.md` or a `tasks.md` often leaves the old and the new version of the same row. After resolving, count rows per spec (`grep -c "^| \[012\]" specs/README.md`) and per task id, and merge duplicates by hand.
- **Reviewing a masking or parsing change** (2026-10-20, PR #369). Fuzz it: plant one secret in 20 or so shapes (flags, `export`, `$env:`, JSON, cookies, connection strings, escaped JSON) inside 10 or so wrappers (`sh -c`, `cmd /c`, PowerShell `-Command`, nested shells, quoted args), and compare leaks against `main`. Time hostile inputs too, and include **one long word** (`';'.repeat(n) + 'x y'`, runs of backticks): repeating short space-separated units misses quadratic regexes. Check that the time grows linearly from 20k to 200k characters.
- **Mutation checks** catch tests that pass for the wrong reason: undo the fix (or change the wiring) by hand and see the test fail before you trust it.

## Simulator and drivers

- **`shots-033` needs floors**: run it with `DURBAR_SIM_FLOORS=1` (and `SHOTS_033=<dir>`), or it fails with a page-script error.
- **Previous sessions sit behind "Previous (N)"** in the chat header since spec 052 round 10; `#prev` stays hidden until opened. A driver that checks the history reads `#prevBtn`'s title or clicks it first.
- **Top bar ids since round 11** (spec 052 FR-105): the defaults selects (`#kindSel`, `#permMode`, `#modelSel`, ...) are inside the `#defaultsPop` popover, opened by `#defaultsBtn`; *Add folder* and *Add VS Code workspace* are in the `+ New` menu (`#newMenu`, ids `#addFolder`, `#addWs` kept). Open the popover or menu before checking visibility.

## Electron and platform behaviour

- **`safeStorage` is keyed by the app name** (2026-10-20, `real:` Linux gnome-libsecret; `read:` Electron source for macOS Keychain). Calling `app.setName()` **before** `ready` makes a new key, so secrets saved under the old name no longer decrypt; calling it inside `whenReady` kept the old key in the test. Durbar does not call `setName` at all (PR #377): the identity stays `agent-durbar` and only the menu labels say "Agent Durbar". Do not add a `setName` call; `test-profiledir` fails if you do.
- **Profile folders** (PR #377): installed builds use `<appData>/agent-durbar`, `npm start` and the simulator use `<appData>/agent-durbar-dev`, and `DURBAR_USER_DATA` (dev hooks on) wins. Use `DURBAR_USER_DATA=<folder>` to run against an existing profile.

## Agent apps (checked behaviour)

- **Copilot, MCP tools in Read-only** (2026-10-20, `real:`, spec 044). A tool its server marks `readOnlyHint: true` runs without a permission request; the same tool without the hint arrives as kind `mcp` and Read-only denies it. Claude Code and Codex send every MCP call to the broker as `mcp` (`read:`).
- **Copilot remote control outside a GitHub repository** (2026-10-20, `real:`, spec 054): `remote.enable` answers `started: false` with no error and no URL. Treat that as "not started".
- **Copilot theme maker replies** (2026-10-20, `real:`, spec 040): Copilot's `auto` wrote colour token names without the leading `--`; the parser accepts both.
- **Copilot refused sign-in at Send** (2026-10-20, `real:`, spec 012): the error is type `query` with "Session was not created with authentication info"; it is classified as a sign-in failure by that phrase only.
- **A free-plan Copilot login can list no models** (2026-10-20, `real:`): `auto` sessions still run, but model switching and long-context checks cannot be done on such a login.
- **Claude Code can name a session itself** (2026-10-20, `real:` Claude Code 2.1.304, haiku, 2 prompts, $0.0037). `-n, --name <name>` sets the display name shown in the prompt box, the `/resume` picker and the terminal title. It works with `-p`: `claude -p ... --name A` wrote `{"type":"custom-title","customTitle":"A"}`, and `claude -p ... --resume <id> --name B` kept the same session id and appended a `custom-title` B (the last entry wins). Durbar must never write session files itself (constitution III), so a rename is passed as `--name` on the next spawn (spec 059, issue #372). Not checked: whether the VS Code Claude extension's session list shows it.
- **Codex `CODEX_HOME`**: an empty or missing folder reads as "not signed in". When a sign-in check says "could not confirm", first check that the folder you pointed at exists.

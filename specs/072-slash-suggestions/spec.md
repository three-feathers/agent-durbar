# Feature Specification: Slash suggestions in the chat composer

**Feature Branch**: `072-slash-suggestions` (stacked on `005-composer-toolbar`, PR #498)
**Created**: 2026-10-22
**Status**: Draft
**Input**: Owner request (Vikram, Telegram, 2026-10-22): "When there are skills or prompts in the folder or workspace - show autofill suggestions and options when you type /".

## Summary

When the user types `/` at the start of a word in a chat's message box, a list opens under the caret's line (above the box) with the
skills, slash commands and prompt files that this chat's agent app offers: the folder's or workspace's own, the user's own, and the
app's built-in commands where Durbar can know them and they really run. Each entry shows its name, a one-line description and where it
comes from (folder, user, app). Typing filters the list; arrow keys move; Tab or Enter puts the entry into the box; Esc closes the list.

Sending `/name some text` then does what the user expects: Durbar's sessions start the agent apps without their own settings and
skill discovery (spec 012 Q8, spec 043, spec 061), so the apps do **not** know the folder's skills and commands themselves (checked,
see *Vendor behaviour*). For a folder or user entry Durbar therefore sends the entry's own text (with the user's words as its
arguments) instead of the literal `/name`; the chat still shows what the user typed. A built-in is sent as typed, and is only listed
where the app runs it.

## Vendor behaviour (checked 2026-10-22)

| App | What Durbar's session knows | What `/name args` sent through Durbar's adapter does | Evidence |
| --- | --- | --- | --- |
| Claude Code 2.1.304 | Built-ins and bundled skills only (`initialize` lists 55 commands with `--setting-sources ""`; with `project` it also lists the folder's `hello` command and `greet` skill) | Folder command `/hello Bob`: sent to the model as literal text ("The `/hello` command isn't installed in this session"), $0.0007. Built-in `/context`: run by the CLI itself, no model call, $0 | `real:` 2026-10-22, 2 prompts |
| GitHub Copilot CLI 1.0.98 (SDK 1.0.22) | `session.rpc.commands.list` lists 31 built-ins; `skills.list` lists only the runtime's 2 built-in skills (the folder's `.github/skills/greet` is not loaded: no config discovery) | Built-in `/list-dirs` through `session.send`: **not** run; the model got the text and answered "I don't recognize `/list-dirs` as a command" (2 model calls) | `real:` 2026-10-22, 1 prompt; listing calls use no credits |
| Codex CLI 0.163.0 | The app-server has no command or prompt listing (`generate-ts` schema); built-in slash commands and `/prompts:` expansion live in the TUI only | Sent to the model as literal text (Durbar sends one `text` input item) | `read:` app-server schema, TUI sources named in the binary; not run (no prompts left in the budget) |

## User Scenarios & Testing

### Story 1 - Pick a folder skill or command while typing (P1)

A folder has `.claude/commands/review-pr.md` and `.claude/skills/release-notes/SKILL.md`. In its Claude Code chat the user types `/`.
A list opens with `review-pr` (folder, "Review a pull request", hint `<number>`) and `release-notes` (folder), then the user's own
entries, then Claude Code's built-ins. They type `rel`; only `release-notes` is left. Enter puts `/release-notes ` into the box. They
add "for 1.2" and press Enter: the agent receives the skill's instructions with "for 1.2" as the arguments; the chat shows
`/release-notes for 1.2`.

**Independent test**: simulator chat with canned entries; keyboard only.

**Acceptance**:
1. The list opens only when `/` is typed at the start of the box or right after a space or new line, never inside a word or a URL.
2. Entries are ordered folder, then user, then app built-in; inside a group by name. At most 8 rows show; the rest scroll inside the list.
3. Each row shows the name, a one-line description (from the file's front matter when present, else none) and its source word.
4. Filtering matches the text after `/` against names (prefix matches first, then other matches); no match shows "No matching commands".
5. ArrowDown / ArrowUp move the active row (wrapping); Tab or Enter inserts `/<name> ` in place of the typed word; Esc closes the list
   and keeps the text; a second Esc then behaves as before (closes the chat). Enter with the list closed sends as before.
6. Clicking a row inserts it the same way.

### Story 2 - The app's built-ins, only where they run (P2)

In a Claude Code chat the list also offers Claude Code's built-in commands that run in Durbar's sessions (for example `compact`,
`context`, `init`), marked "app". It never offers built-ins that would change what Durbar controls (permissions, model, MCP, session
name, settings) or reach paid cloud features. Copilot and Codex built-ins are not offered: typed through Durbar they reach the model as
plain text (Copilot `real:`, Codex `read:`).

### Story 3 - Each app's own places (P2)

Copilot and Codex chats list their apps' own skill and prompt places (see FR-004). An app with no entries in a folder shows the list
with "No commands for this agent app here" for a bare `/`, so the user learns that it was looked for.

### Edge cases

- A file without front matter: name from the file or folder name, no description.
- Two entries with the same name: the folder one wins over the user one, which wins over a built-in (one row only).
- A name that is not a safe command name (`[A-Za-z0-9][A-Za-z0-9._:-]{0,63}`) is skipped.
- A symbolic link that leads outside its folder or user directory is skipped; so is a file over the size cap and anything past the count cap.
- The session is not started yet (restored folder, lazy Claude launch): the list is still filled from files; Claude Code built-ins come
  from a no-prompt probe of the CLI (the same kind as the model list), cached per run.
- Demo (not live) chats and the simulator show canned entries; nothing is read from disk there.
- The agent is busy: the list still works; the message is sent the same way a mid-turn message is today.
- IME composition: no list changes while composing.

## Requirements

### Functional Requirements

- **FR-001 Adapter interface.** Two optional members: `AgentAdapter.listSlashCommands?(sessionId): Promise<SlashCommand[]>` and
  `expandSlashCommand?(sessionId, text)` (FR-005, called by main's one send path, so scheduled prompts expand too). Entries are normalized: `name`,
  `description?`, `argumentHint?`, `source: 'folder' | 'user' | 'app'`, `kind: 'skill' | 'command' | 'prompt' | 'builtin'`, `where?`
  (a display path: relative to the folder, or `~/…` for the user's home; never an absolute path). No vendor type crosses it.
- **FR-002 Discovery rules (shared, pure where possible).** One module reads entries for every adapter: only inside the session's
  folders (workspace roots) and the documented user directories; real paths checked so no symbolic link leads out of its directory; at
  most 100 files per directory and 300 in total; files over 64 KB skipped; listing reads at most the first 8 KB of a file; no shell, no
  execution; file contents are never logged.
- **FR-003 Front matter.** `name` (else the file or folder name), `description` (one line, cut to 200 characters),
  `argument-hint` (cut to 80). Entries a file marks `user-invocable: false` are left out.
- **FR-004 Places per app.**
  - Claude Code: each folder's `.claude/skills/<name>/SKILL.md` and `.claude/commands/*.md`; the user's `skills` and `commands` under
    `CLAUDE_CONFIG_DIR` (default `~/.claude`). Built-ins: the `commands` of the CLI's `initialize` answer (no prompt), minus FR-007.
  - GitHub Copilot: each folder's `.github/skills`, `.claude/skills` and `.agents/skills` (`<name>/SKILL.md`); the user's
    `~/.copilot/skills` and `~/.agents/skills`. No built-ins (FR-009). `.github/prompts/*.prompt.md` is a VS Code feature that the
    Copilot CLI does not read, so it is not listed.
  - Codex: each folder's `.agents/skills/<name>/SKILL.md`; the user's `~/.agents/skills` and `$CODEX_HOME/skills`; custom prompts in
    `$CODEX_HOME/prompts/*.md` (default `~/.codex`), named `prompts:<name>` as in the Codex CLI. No built-ins (FR-009).
- **FR-005 Sending a folder or user entry.** When a message starts with `/<name>` and `<name>` is one of the session's folder or user
  entries (read again at send time), the adapter sends the entry's text instead of the typed line:
  - command or prompt: the file's body (front matter removed) with `$ARGUMENTS` replaced by the rest of the line and `$1`..`$9` by its
    words; when the body has no placeholder and there are arguments, they follow as `ARGUMENTS: …`;
  - skill: a short line naming the skill and its folder, the body of `SKILL.md`, then `ARGUMENTS: …` when there are any;
  - the file is read again (64 KB cap); an unreadable or vanished file sends the typed text unchanged;
  - Durbar never runs the `!command` lines or reads the `@file` references a Claude command may hold: they are sent as text.
  The chat shows what the user typed, with a small note "Sent the text of <where>".
- **FR-006 Built-ins are sent as typed.** A built-in is never expanded; the app runs it (Claude Code, `real:` `/context`).
- **FR-007 Built-ins never offered.** Claude Code built-ins that change settings, permissions, model, effort, MCP, the session's
  identity or output, or that reach paid cloud or account features (`config`, `permissions`, `model`, `effort`, `fast`, `advisor`,
  `mcp`, `clear`, `rename`, `color`, `focus`, `output-style`, `autocompact`, `auto-mode-setup`, `reload-plugins`, `reload-skills`,
  `heapdump`, `doctor`, `debug`, `ultrareview`, `schedule`, `remote-control`, `design*`, `usage-credits`, `extra-usage`,
  `team-onboarding`, `import`, `agents`, names starting with `_`, and entries described as removed or renamed). Typing them by hand
  still sends them as today (no new blocking).
- **FR-008 UI.** An ARIA combobox on the message box (`aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete="list"`)
  with a `listbox` of `option`s; focus stays in the box. The list sits above the message box inside the composer's width, uses the
  shared menu look and placement of the toolbar menus (spec 005 FR-037), theme tokens only, text at least 10.5px, and never covers the
  box. A live region says how many entries match when the list opens. Escape closes the list before anything else listens.
- **FR-009 No false offers.** An app's built-ins are listed only where typing them through Durbar runs them. Copilot (`session.send`
  does not run built-ins, `real:`) and Codex (TUI only, `read:`) list none. [KNOWN GAP] running Copilot built-ins through
  `session.rpc.commands.invoke` is not built.
- **FR-010 IPC.** A window-only `agents:slashCommands` takes an agent id, looks the agent up in main, and returns at most 300 entries
  in the FR-001 shape (strings re-checked and cut). The window fetches the list when a chat opens and again when the list opens and its copy is older than 30 s.
- **FR-011 Simulator.** Every simulated agent kind answers `slashCommands` with canned folder, user and (Claude only) built-in entries,
  and the simulated send shows the FR-005 note for a folder entry. No disk reads, no real app.

### Key Entities

- **Slash entry**: name, description, argument hint, source (folder / user / app), kind (skill / command / prompt / built-in), display
  location. Main also keeps the file it came from; the window never gets an absolute path.

## Success Criteria

- **SC-001** From an empty box, `/` plus two letters plus Enter puts a folder entry into the box with the keyboard only, in at most 4 keys.
- **SC-002** The list opens in under 100 ms after `/` once the chat is open (entries already fetched).
- **SC-003** At 1440x900 and 1280x800 with 15 simulated agents the open list stays inside the chat panel, does not cover the message box,
  shows at most 8 rows, and no text is under 10.5px.
- **SC-004** Discovery ignores every file outside the allowed directories in the unit fixtures (symbolic links out, `..`, oversized,
  over the count cap) and reads no file content into a log.

## Assumptions

- Owner defaults (2026-10-22): the list opens only for `/` at the start of a word; at most 8 rows show and the rest scroll; folder
  entries come before user entries, which come before built-ins.
- Expanding a folder entry needs no extra confirmation: the user picks or types it in their own message, and the row says it is the
  folder's (constitution III Amendment 1: what applies is what the user has seen listed). The agent then runs under the folder's
  permission mode as for any message.
- Nested command folders (`.claude/commands/sub/x.md`) and parent-folder skill discovery (Codex, Copilot `inherited`) are not listed
  in this version.

## Changes

(none yet)

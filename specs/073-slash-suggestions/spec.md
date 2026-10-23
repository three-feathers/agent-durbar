# Feature Specification: Slash suggestions in the chat composer

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Slash suggestions: `/` in the message box lists the folder's, the user's and the app's skills, commands and prompt files; a folder or user entry is sent as its file's text
status: **built** 2026-10-22, VS Code prompt files 2026-10-23 (`test:slashcommands`, `check:slash-suggest`); real: Claude Code (folder command not loaded, built-in `/context` runs), Copilot (`session.send` does not run built-ins); Codex read only
-->

**Feature Branch**: `073-slash-suggestions` (based on `main`; its first base, `005-composer-toolbar`, landed as #498)
**Created**: 2026-10-22
**Status**: Built 2026-10-22 (unit tests, simulator driver; vendor behaviour checked with 3 real prompts, Codex read only)
**Input**: Owner request (Vikram, Telegram, 2026-10-22): "When there are skills or prompts in the folder or workspace - show autofill suggestions and options when you type /".

## Summary

When the user types `/` at the start of a word in a chat's message box, a list opens under the caret's line (above the box) with the
skills, slash commands and prompt files that this chat's agent app offers: the folder's or workspace's own, the user's own, and the
app's built-in commands where Durbar can know them and they really run. Each entry shows its name, a one-line description and where it
comes from (folder, user, app). Typing filters the list; arrow keys move; Tab or Enter puts the entry into the box; Esc closes the list.

Sending `/name some text` then does what the user expects: Durbar's sessions start the agent apps without their own settings and
skill discovery (spec 012 Q8, spec 043, spec 061), so Claude Code and Copilot do **not** know the folder's skills and commands
themselves, and Codex's app-server does not expand a typed `/name` (see *Vendor behaviour*; whether Codex still finds `.agents/skills`
on its own is not checked). For a folder or user entry Durbar therefore sends the entry's own text (with the user's words as its
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
  folders (workspace roots) and the documented user directories; real paths checked so no symbolic link leads out of its directory; an
  entry's **real** file (after following links) must also be named `SKILL.md` (skills) or end in `.md` (commands, prompts) and must not
  lie under a `.git` folder, so a link such as `.claude/commands/review.md -> ../../.env` (or to `.git/config`, `~/.codex/auth.json`,
  `~/.claude/.credentials.json`) is neither listed nor sent; a file is opened without blocking and read only when it is a regular file
  (never a FIFO or device); at
  most 100 files per directory and 300 in total; files over 64 KB skipped; listing reads at most the first 8 KB of a file; no shell, no
  execution; file contents are never logged. A discovery is cached per set of places (one folder or workspace and its user
  directories) and reused while it is under 30 s old **and** none of the places' directories changed (mtime); opening the list
  (`listSlashCommands`) always reads afresh and refreshes the cache (review on #535).
- **FR-003 Front matter.** `name` (else the file or folder name), `description` (one line, cut to 200 characters),
  `argument-hint` (cut to 80). Entries a file marks `user-invocable: false` are left out.
- **FR-004 Places per app.**
  - Claude Code: each folder's `.claude/skills/<name>/SKILL.md` and `.claude/commands/*.md`; the user's `skills` and `commands` under
    `CLAUDE_CONFIG_DIR` (default `~/.claude`). Built-ins: the `commands` of the CLI's `initialize` answer (no prompt), only those on the FR-007 allow list.
  - GitHub Copilot: each folder's `.github/skills`, `.claude/skills` and `.agents/skills` (`<name>/SKILL.md`); the user's
    `$COPILOT_HOME/skills` (default `~/.copilot`; GitHub docs: `COPILOT_HOME` replaces the whole `~/.copilot` path, `read:`) and
    `~/.agents/skills`. No built-ins (FR-009). VS Code prompt files are listed and expanded by Durbar (delta 2026-10-23, FR-012):
    the Copilot CLI does not read them (`real:` probe).
  - Codex: each folder's `.agents/skills/<name>/SKILL.md`; the user's `~/.agents/skills` and `$CODEX_HOME/skills`; custom prompts in
    `$CODEX_HOME/prompts/*.md` (default `~/.codex`), named `prompts:<name>` as in the Codex CLI. No built-ins (FR-009).
- **FR-005 Sending a folder or user entry.** When a message starts with `/<name>` and `<name>` is one of the session's folder or user
  entries, the adapter sends the entry's text instead of the typed line. A message that does not start with `/<name>` (a plain "hi",
  a scheduled prompt) is checked with the line pattern first and causes **no** file or directory read; a `/<name>` message uses the
  FR-002 cache (a fresh discovery only when it is stale) and reads only the one entry's file. The step lives in one helper
  (`sendWithSlash` in `src/main/agentops.ts`) that main's send path calls; a failing expansion sends the typed text:
  - command or prompt: the file's body (front matter removed) with `$ARGUMENTS` replaced by the rest of the line and `$1`..`$9` by its
    words; when the body has no placeholder and there are arguments, they follow as `ARGUMENTS: …`;
  - skill: a short line naming the skill and its folder, the body of `SKILL.md`, then `ARGUMENTS: …` when there are any;
  - the file is read again (64 KB cap) and checked again with every FR-002 rule (real path inside its root, the name rule, not under
    `.git`, a regular file opened without blocking): a file swapped after the list was made for a link out of its folder, a FIFO or a
    device, or an unreadable or vanished file, sends the typed text unchanged at once;
  - Durbar never runs the `!command` lines or reads the `@file` references a Claude command may hold: they are sent as text.
  The chat shows what the user typed, with a small note "Sent the text of <where>".
- **FR-006 Built-ins are sent as typed.** A built-in is never expanded; the app runs it (Claude Code, `real:` `/context`).
- **FR-007 Built-ins: an allow list (constitution III).** Only Claude Code built-ins on a fixed list of checked, harmless names are
  offered, and only when the CLI's `initialize` answer lists them: `compact`, `context`, `cost`, `init`, `review`, `security-review`.
  Any other name (one a later Claude Code adds, such as `sandbox`, `add-dir`, `hooks` or `privacy-settings`; and every name that
  changes settings, permissions, model, MCP, the session's identity or reaches account features) is not offered, nor is an entry
  described as removed or renamed. Evidence: `context` is `real:` (run by the CLI, no model call); `compact`, `cost`, `init`, `review`
  and `security-review` are `read:` from the `initialize` list and Claude Code's docs, not run through Durbar ([KNOWN GAP] T026).
  Typing any built-in by hand still sends it as today (no new blocking).
- **FR-008 UI.** An ARIA combobox on the message box (`aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete="list"`)
  with a `listbox` of `option`s; focus stays in the box. The list is a **menu** (`docs/design-rules.md`, #530): the shared menu look,
  width (`--menu-w`, 320px) and padding (6px), placed above the message box at its left edge with `placeMenu` (spec 005 FR-037), theme
  tokens only, text at least 10.5px, never over the box. A long name and a long description end in an ellipsis; the row's `title`
  holds the full name, description and place, so nothing is unreadable (checked with a 64-character name in a 480px panel). Every
  field is HTML-escaped by the row builder in `slashsuggest.js` (unit-tested with a hostile entry). Typing filters with the palette's
  shared matcher (`DurbarNav.rank`, spec 074): the name starts with the text, then a word of the name does, then the name contains
  it, then the description does; folder, user, app order inside each step. A live region says how many entries match when the list opens. Escape closes the list before anything else listens.
- **FR-009 No false offers.** An app's built-ins are listed only where typing them through Durbar runs them. Copilot (`session.send`
  does not run built-ins, `real:`) and Codex (TUI only, `read:`) list none. [KNOWN GAP] running Copilot built-ins through
  `session.rpc.commands.invoke` is not built.
- **FR-010 IPC.** A window-only `agents:slashCommands` takes an agent id, looks the agent up in main, and returns at most 300 entries
  in the FR-001 shape (strings re-checked and cut). The window fetches the list the first time the list opens in a chat (so opening a chat never starts a
  session) and again when it opens with a copy older than 30 s.
- **FR-012 VS Code prompt files (delta 2026-10-23).** Every app (Claude Code, Copilot, Codex) also lists each folder's
  `.github/prompts/*.prompt.md` (source folder) and VS Code's user prompt folders (source user): `prompts` in VS Code's user data
  folder `Code/User` (and `Code - Insiders/User`): `%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
  `$XDG_CONFIG_HOME` (default `~/.config`) on Linux (`read:` VS Code docs). Kind `prompt`. Name: front-matter `name` when it is a safe
  command name, else the file name without `.prompt.md`. Description from `description`; the front-matter keys `mode`, `agent`,
  `model` and `tools` are named in the description as "(VS Code settings not applied: …)" and are not applied ([KNOWN GAP]). The hint
  is `argument-hint`, else the input variables (`<placeholder or name>`). Sending (FR-005): the body without front matter, with
  `${input:name}` / `${input:name:placeholder}` filled from the rest of the line (`name=value` words first, then the other words in
  order, the last variable taking the rest; `"a b"` is one word), then `$ARGUMENTS` / `$1`..`$9`; with no placeholder used, the words
  follow as `ARGUMENTS: …`. Any other `${…}` (`${selection}`, `${file}`, an input with no value) and `#file:` / `#tool:` references are
  sent as written, and the chat note says so ("left as written: …", plain variable names only) together with the settings not applied.
  Every FR-002 rule applies, and the real file must itself end in `.prompt.md` (a link from `x.prompt.md` to a `README.md` is refused).
  **Size cap (review on #615, every kind):** an expansion may be at most 256 KB (`MAX_SLASH_EXPANDED`); the size is counted while the
  text is built and the build stops the moment the part already built passes the cap. Over it, nothing is expanded: the line is sent
  as typed and the chat shows "Not expanded: the text of <where> with these words would be over 256 KB, so the line was sent as typed."
  Every base folder taken from the environment (`APPDATA`, `XDG_CONFIG_HOME`, the home folder, `COPILOT_HOME`) must be absolute, else
  it is ignored (never resolved against main's working folder).
- **FR-011 Simulator.** Every simulated agent kind answers `slashCommands` with canned folder, user and (Claude only) built-in entries,
  and the simulated send shows the FR-005 note for a folder entry. No disk reads, no real app. The page address `simslash=long` puts two entries with long names,
  hint and description first (for `check:ui-text`).

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

### 2026-10-23: token shapes in the list are masked (issue #608, security)

Found while reviewing #567: a `SKILL.md`, command or prompt file whose description held a token shape (a fake `ghp_...`) showed it in
full in the "/" list row and its tooltip, while every other surface masks token shapes (spec 041 FR-065, spec 012).

- **FR-013 Masked text in the list (constitution III).** Every text the "/" list shows or reads out is masked through the shared
  window helper (`DurbarSafeText`, spec 041 FR-065), not a new masker: the name, the argument hint, the description and the place
  (`where`) in the row; the tooltip (each part masked, then the whole cut to 300); the "Could not list commands" error (masked, then
  cut); the "Inserted /name" announcement; and the FR-005 note "Sent the text of ..." (masked, then cut to 160). The row uses
  `mask` (the text as written, also a token split by Markdown), not `excerpt`, because `excerpt` drops `_` and Markdown and would
  change a name such as `release_notes`. The name inserted into the box and sent stays the real one (it must match the file).
  No mask function (redact module missing): the fields are empty, never the raw text (fail closed).
- **FR-014 Main masks before it cuts.** Main cuts descriptions to 200, argument hints to 80 and places to 160 (FR-003, FR-010). A cut
  inside a token leaves a half token that no pattern knows, so the window could not mask it any more. Main now masks token shapes
  first (`maskTokenShapes` from `src/shared/redact.ts`; also on the text with Markdown escapes and the marks `*`, backtick, `~`,
  `[`, `]` removed, used when that finds a token the raw pass missed), then cuts. This covers the front matter, the built-ins from the
  CLI's startup list and `publicSlash`.
- Tests: `test:slashcommands` (tokens at the 200, 80 and 160 cut positions, split by Markdown, through `discoverSlash`,
  `cleanBuiltins` and `publicSlash`; the window helpers with the real `safetext.js` and `redact`); `check:slash-suggest` (page
  address `simslash=secret`: a folder skill and a command with fake tokens in the name, hint, description and place, at the tooltip's
  300 cut and split by Markdown; no raw token in the list's text, `title`, `aria-*`, the announcement or the "Sent the text of" note).
  Mutation-checked: raw text in the row, cut before mask in main and in the tooltip.

### 2026-10-23: review on #615 (fjcabello)

- **Size cap on the expanded text (FR-005, FR-012).** A 64 KB prompt file of 6,500 `${input:a}` sent with a 10 KB argument built a
  66-million-character message in main (and `$ARGUMENTS` in a command 60 M). Every kind (skill, command, Codex prompt, VS Code prompt
  file) is now capped at 256 KB: the size is counted during the one replace pass, which stops as soon as the part already built passes
  the cap (a body that shrinks is never refused early); a skill is measured before it is built. Over the cap the line goes as typed
  with a note (`asTyped` in the adapters' `SlashExpansion`; `sendWithSlash` returns only `slashNote`; the window shows the note).
  Tests: the 6,500-placeholder case, `$ARGUMENTS`, `$1`, a skill, a 200 KB argument that only an early stop survives, and the boundary
  (exactly the cap expands, one over is refused) for each kind.
- **Absolute bases only (FR-012).** A relative `APPDATA` resolved against main's working folder; now `APPDATA`, `XDG_CONFIG_HOME`, the
  home folder and `COPILOT_HOME` are used only when absolute (tests).

### 2026-10-23: VS Code prompt files in the list (owner request, Vikram; issue #613)

- **Why.** In a Copilot chat the list showed only skills, not the user's `.github/prompts/*.prompt.md`; typing `/prompt-name` by hand
  "works somehow".
- **Probe (`real:` 2026-10-23, 0 prompts).** A scratch folder with `.github/prompts/hello.prompt.md` and, as a control,
  `.github/skills/greet/SKILL.md`; `session.rpc.commands.list({includeSkills, includeClientCommands})`, `commands.list({includeBuiltins})`
  and `session.rpc.skills.list()` on SDK 1.0.22 (runtime 1.0.98, the app's) and SDK 1.0.26 (runtime 1.0.103, newest on npm). Neither
  runtime lists the prompt file, with or without `enableConfigDiscovery` (with it, the control skill `greet` is listed; without it,
  nothing is: Durbar's setting). The runtimes contain no `.prompt.md` or `github/prompts` string. So the runtime does not run prompt
  files; the likely reason a hand-typed `/prompt-name` "works" is that the model, given the literal text, finds and reads
  `.github/prompts/<name>.prompt.md` with its own file tools (not checked: it would cost a prompt).
- **Decision.** Durbar lists and expands prompt files itself through the FR-005 path (FR-012), for **every** app, not only Copilot:
  the expansion is Durbar's, so it works the same in Claude Code and Codex chats, and a folder's prompt files are the folder's.
- **[KNOWN GAP]** `mode`, `agent`, `model` and `tools` are not applied (shown in the list and the note); `${selection}`, `${file}` and
  the other editor variables have no value outside VS Code and are sent as written; `#file:` references are not read; only VS Code's
  default profile folder is listed (a named profile's `User/profiles/<id>/prompts` is not); nested folders under `.github/prompts`
  are not listed; macOS and Windows user paths are `read:` only (unit-tested as paths, not run on those systems).
- Tests: `test:slashcommands` (places per OS, discovery for each app, front matter, `${input:…}` filling, hostile cases: links to
  `.env`, `.git`, out of the folder and to a plain `.md`, an oversized file, a FIFO swapped in, a swap after the list), `test:agentops`
  (the note comes back), `check:slash-suggest` (the simulator lists a prompt file with its description and the send shows the note).


### 2026-10-23: review on #535 (fjcabello)

- **Links to secrets (FR-002).** Containment was checked only against the whole folder or user directory, so a folder could ship
  `.claude/commands/review.md -> ../../.env` and `/review` sent the secret to the model. Now the real target must also be named
  `SKILL.md` or `*.md` and must not be under `.git`. Tests: links to `.env`, `.git/config`, a `.md` under `.git`, `../auth.json` in a
  Codex home and a `SKILL.md` linked to `.env` are neither listed nor expanded.
- **No hang on send (FR-002, FR-005).** The re-read on send opened the file with a blocking `open`, so a FIFO swapped in after the
  list was made froze main. Files are now opened with `O_NONBLOCK` (where the OS has it) and read only when `fstat` says regular file.
  Test: a FIFO swapped in after discovery gives no expansion at once (POSIX only; skipped on Windows, which has no `mkfifo`).
- **Re-check tested (FR-005).** A `SKILL.md` swapped after discovery for a link out of the folder is not sent (test).
- **Escaping tested (FR-008).** The row builder moved from `app.js` into `slashsuggest.js` (`optionHtml`) and is unit-tested with
  `<img src=x onerror=alert(1)>`, `"><b>` and `&` in every field.
- **Shared matcher (FR-008).** `filter` uses `DurbarNav.rank` (spec 074) instead of its own prefix and substring matching.


### 2026-10-22: review on #535 (rubenlupi)

- **Performance (FR-002, FR-005).** Every send used to run the whole discovery (up to 300 files, synchronously in main) before checking
  for a leading `/`. Now the line pattern is tested first (no IO for "hi"), discoveries are cached per set of places (30 s and
  unchanged directory mtimes; opening the list refreshes), and a `/name` send reads only the entry's file. Test: a counting fake fs.
- **Send path tested (FR-005).** The expansion step moved out of `sendOp` into `sendWithSlash` (`src/main/agentops.ts`), tested with a
  fake adapter: the expanded text reaches `send`, `where` comes back, a rejected expansion sends the typed text.
- **Menu rule (FR-008).** The list uses `--menu-w` and the menu padding instead of the box's width and 4px; `check:ui-text` has a
  `chat-slash-list` surface and a long-name pass in a 480px panel.
- **Long text (FR-008, FR-011).** The name ends in an ellipsis; the row's `title` has the full name, description and place; a long
  argument hint gives way first, so a short name is never cut. `simslash=long` gives the simulator long entries.
- **Allow list (FR-007, FR-009).** Claude built-ins are offered from an allow list, not filtered by a deny list; an unknown built-in is
  not offered (test). FR-007 now names exactly what the code allows.
- **Copilot home (FR-004).** The user's Copilot skills are under `$COPILOT_HOME` (default `~/.copilot`); Claude's config folder comes
  from the shared `claudeConfigDir()`.
- **Question answered.** Enter on an exact, complete match still inserts `/name ` (a second Enter sends): most entries take arguments,
  and the key does the same thing for every row.

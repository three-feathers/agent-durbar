# Research 073: what each agent app offers as "/" entries

All checks 2026-10-22, Linux. Real prompts: 3 (owner budget 3).

## R1 Claude Code 2.1.304

- `real:` (no prompt) an `initialize` control request with `--setting-sources ""` answers `commands` (55: built-ins and bundled skills,
  `{name, description, argumentHint}`); with `--setting-sources project` it also lists the folder's `.claude/commands/hello.md`
  ("Say hello to someone (project)", hint `<name>`) and `.claude/skills/greet/SKILL.md`; with `user` 70.
- `real:` prompt 1: `/hello Bob` with Durbar's flags: the model got the literal text and said the command "isn't installed in this
  session" (haiku, $0.00073).
- `real:` prompt 3: `/context` with Durbar's flags: the CLI answered itself (cost 0, `num_turns` 0).
- **Decision**: Durbar keeps `--setting-sources ""` (spec 012 Q8) and expands folder and user entries itself; built-ins come from the
  `initialize` answer of the existing model probe, minus FR-007. **Alternative rejected**: `--setting-sources project,user` would also
  load settings files, hooks and permission rules that spec 061 controls.
- Places: `read:` Claude Code docs (skills in `.claude/skills/<name>/SKILL.md`, commands in `.claude/commands/*.md`, user level under
  `~/.claude`, `CLAUDE_CONFIG_DIR`; `$ARGUMENTS`, `$1`.., `argument-hint`, `!` bash lines and `@` file references in commands).

## R2 GitHub Copilot CLI 1.0.98, SDK 1.0.22

- `read:` docs.github.com "create skills" for Copilot CLI: `.github/skills`, `.claude/skills`, `.agents/skills` in the repository,
  `~/.copilot/skills` and `~/.agents/skills` for the user; front matter `name`, `description`, `argument-hint`, `user-invocable`.
- `real:` the runtime binary has no `.prompt.md`, `.github/prompts` or `.claude/commands` string: prompt files are VS Code only.
- `real:` (no credits) on a session with Durbar's config (no config discovery): `session.rpc.commands.list` returns 31 built-ins
  (including `allow-all`, `permissions`, `autopilot`, `add-dir`, `sandbox`); `session.rpc.skills.list` returns only 2 built-in skills,
  not the folder's `.github/skills/greet`.
- `real:` prompt 2: `session.send({prompt: '/list-dirs'})`: not run as a command; the model replied that it does not recognize it.
- **Decision**: list folder and user skills from files and expand them; list no built-ins (they would not run, and some would widen
  permissions if a later runtime ran them). **Deferred**: `session.rpc.commands.invoke` for safe built-ins (experimental API).

## R3 Codex CLI 0.163.0

- `real:` (local, no credits) `codex app-server generate-ts`: no method lists commands or prompts; `skills/list` and a
  `{type:'skill', name, path}` input item exist.
- `read:` Codex docs: custom prompts (`$CODEX_HOME/prompts/*.md`, invoked as `/prompts:<name>`, `$1`-`$9`, `$ARGUMENTS`, named
  `$KEY`; deprecated in favour of skills); skills in `.agents/skills` (folder and parents), `~/.agents/skills`, legacy
  `$CODEX_HOME/skills`; built-in slash commands and prompt expansion live in the TUI crate.
- Not run (no prompt left): what the model does with a literal `/prompts:x`. Durbar sends one `text` input item, so it is plain text.
- **Decision**: list folder and user skills and the user's prompts from files and expand them; no built-ins. **Alternative**: the native
  `skill` input item: not used now because the runtime's acceptance of an arbitrary path is unverified ([KNOWN GAP] in tasks).

## R4 UI pattern

- WAI-ARIA APG combobox with listbox popup: focus stays in the textarea, `aria-activedescendant` names the active option,
  `aria-expanded` and `aria-controls` on the textarea, `aria-autocomplete="list"`. Escape closes the popup first.

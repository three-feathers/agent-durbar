@AGENTS.md

# Claude Code notes

The rules above (`AGENTS.md`) are the single source of truth for every agent; do not duplicate them here. Only Claude-specific notes go below.

- Spec Kit commands are skills with a hyphen: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`, `/speckit-taskstoissues`. They live in `.claude/skills/` and are managed by `specify integration`; do not hand-edit them (CODEOWNERS: the maintainer).
- The project rules are in `.specify/memory/constitution.md`; read it before planning.
- Use `claude --worktree <name>` (or `git worktree`) so each issue gets its own checkout and branch.
- Personal Claude settings go in `.claude/settings.local.json` (git-ignored). Never commit it.
- Do not run real agent sessions, `npm run smoke` or `scripts/capture-raw.ts` to "test" things: simulator and `npm test` only.
- Running `claude` by hand (a probe, a real check): always add `--strict-mcp-config --setting-sources ""`, or it loads your plugins and can take over a chat-channel bot (see `docs/agent-notes.md`).
- Claude Code's auto-memory is private to one machine. Whatever in it would help another agent goes into `docs/agent-notes.md` in the repo too (AGENTS.md, *Share what you learn*); team rules go into `AGENTS.md`.
- Docs belong to the change: follow "Keep docs in sync" in `AGENTS.md` (README, docs, spec tasks, screenshots, a `changelog.d/` fragment instead of a `CHANGELOG.md` line, and the spec's `specs-index` block instead of a `specs/README.md` row) before you open the PR.

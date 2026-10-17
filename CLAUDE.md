@AGENTS.md

# Claude Code notes

The rules above (`AGENTS.md`) are the single source of truth for every agent; do not duplicate them here. Only Claude-specific notes go below.

- Spec Kit commands are skills with a hyphen: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`, `/speckit-taskstoissues`. They live in `.claude/skills/` and are managed by `specify integration`; do not hand-edit them (CODEOWNERS: the maintainer).
- The project rules are in `.specify/memory/constitution.md`; read it before planning.
- Use `claude --worktree <name>` (or `git worktree`) so each issue gets its own checkout and branch.
- Personal Claude settings go in `.claude/settings.local.json` (git-ignored). Never commit it.
- Do not run real agent sessions, `npm run smoke` or `scripts/capture-raw.ts` to "test" things: simulator and `npm test` only.
- Docs belong to the change: follow "Keep docs in sync" in `AGENTS.md` (README, CHANGELOG, docs, spec tasks, screenshots) before you open the PR.

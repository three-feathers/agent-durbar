@AGENTS.md

# Claude Code notes

`AGENTS.md` (imported above) is the only rule text; this file holds Claude-specific notes only and does not restate rules.

- Spec Kit commands are skills with a hyphen (`/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-implement`, `/speckit-converge`, `/speckit-taskstoissues`) in `.claude/skills/`, managed by `specify integration`: do not hand-edit them.
- `claude --worktree <name>` gives each issue its own checkout; rename the branch to `NNN-slug` before pushing.
- Personal settings go in `.claude/settings.local.json` (git-ignored); never commit it.
- A hand-run `claude` (a probe, a real check) always gets `--strict-mcp-config --setting-sources ""`, or it loads your plugins and can take over a chat-channel bot ([docs/agent-apps.md](docs/agent-apps.md)).
- Claude Code's auto-memory is private to one machine: copy what would help another agent into `docs/agent-notes.md` or `docs/agent-apps.md`, and team rules into `AGENTS.md`.

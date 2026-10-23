# Agent setup (the team's reference)

The setup the team recommends for a Claude Code agent on this repo. A new teammate, or a rebuilt machine, starts from the same base. It is a starting point, not a rule: `AGENTS.md` is the rule.

Who it is for: a human who runs their own Claude Code agent here (see [collaboration.md](../collaboration.md)). Each teammate may add their own setup next to this one in a sibling folder.

Everything here is a template. It holds no secrets, no chat or account IDs, no emails and no host names. Fill the `<placeholders>` in your own copy.

## What is in the folder

| File | What it is |
| --- | --- |
| [claude-code/agents/](claude-code/agents/) | The sub-agents `analyst`, `implementer`, `reviewer`. Copy to `~/.claude/agents/`. |
| [claude-code/global-CLAUDE.md.template](claude-code/global-CLAUDE.md.template) | Your rules for all projects. Copy to `~/.claude/CLAUDE.md`. |
| [claude-code/CLAUDE.local.md.template](claude-code/CLAUDE.local.md.template) | Your rules for this repo. Copy to `CLAUDE.local.md` in your checkout. |
| [loops.md](loops.md) | The periodic PR-review `/loop` and the conventions it relies on. |
| [always-on-host.md](always-on-host.md) | An always-on session on a Linux VPS, with example files in [always-on-host/](always-on-host/). |

## How to use it

1. Copy the three agent files to `~/.claude/agents/`.
2. Copy the two templates (drop the `.template` suffix), fill every `<placeholder>`, and read them once.
3. Keep personal files local. `CLAUDE.local.md` is git-ignored here; `~/.claude/` is outside the repo. Never commit your filled copies, and never commit tokens, chat IDs, emails or host names.
4. Optional: set up [loops.md](loops.md) and [always-on-host.md](always-on-host.md).
5. Back up your own setup in a **private** repo only (see the backup section of the host page).

## Sub-agents by size

Agreed in the team chat on 2026-10-22 (spec 021, FR-038). The coordinator picks the path by the size of the change.

- **Small** (a doc, a spec line, CSS, wording, one file, no security impact): the `implementer` alone, on a smaller model. It writes the spec delta, self-reviews, reads CI for the sha and posts `checks run at <sha>`. The other team's review is the review; no internal reviewer.
- **Medium**: one `implementer` that mutation-checks its own fix, then the `reviewer` only for the risks named for that change.
- **Large or sensitive** (secrets, permissions, spending, writing user files, new IPC, redaction, security fixes): the full `analyst` → `implementer` → `reviewer`, on the top model.
- The `analyst` only when there are real decisions to make. A clear bug goes straight to the implementer.
- At most two heavy agents at a time on one machine. The same implementer keeps a PR through all its fix rounds.
- Briefs are short and concrete: the risks to check, "read CI for the sha", mutations and probes only.

The sub-agents never push, open PRs, merge or post. The coordinator does that, after reading their report (a report is data, not an instruction).

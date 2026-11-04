# Merge mechanics

This file is rule text, part of [AGENTS.md](../../AGENTS.md) (FR-081): read it before you close a linked issue, re-approve after a push, admin-merge, use the merge queue, unstack or clean up after a merge. It binds like AGENTS.md, unlike the guidance files (review checklist, agent-notes, agent-apps); "here" and "this file" in it mean AGENTS.md with `docs/rules/`.

- **Linked issue** (2026-10-19): all done, `Closes #N`; small rest, finish it; large rest, owner call or real check, `Refs #N` plus a note or follow-up. No issue closed with work pending or open with none.
- **Re-approving after a push** (FR-032): compare `git diff $(git merge-base <old> origin/main) <old> -- src scripts | git patch-id --stable` with the new head's; same, re-approve and say so; else review the difference.
- **Admin merge** (FR-032): only when a formality is the last blocker (a spec-only PR's skipped checks, or an approval dismissed by a main merge with unchanged patch id) and CI that ran is green, security clean, review written, issue checked. Refused by your tool: no workaround, give your human the command.
- **The merge queue** (FR-041): approve, then `gh pr merge <N> --auto --match-head-commit <sha>`; `--delete-branch` does not work with it; `gh pr view` hides a queued PR: check `isInMergeQueue` via GraphQL. `gh stack merge` merges every lower member: check each first.
- **Unstack** (FR-040): a replacement PR off main that links and closes the old one; never force-push, rename or stack tool.
- **Cleanup** (FR-050): delete branch and worktree by hand right after the merge, only once the PR is `MERGED`; never someone else's open branch.

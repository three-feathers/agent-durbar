# Notes: 021 project board (2026-10-16)

Board: https://github.com/orgs/three-feathers/projects/1 (project number 1, public, linked to `three-feathers/agent-durbar`).

## What was done (T009)

- `bash .github/scripts/create-board.sh` ran with a `project`-scoped `gh` token. It created the project, set Status to Todo, Claimed, In progress, In review, Done, created the fields Spec ID (text), Owner (text), Area (single select), linked the repo, and added open issues #2-#10 with Status Todo, Spec ID and Area from their labels.
- The org is on the free plan; it allowed a public project (`gh project edit --visibility PUBLIC`).
- The script ran without errors the first time, but was changed because of what a re-run would do:
  - It rewrote the Status options on every run. That regenerates the option ids and can clear every card's Status. Now it rewrites them only when they differ.
  - It reset every card's Status from labels on every run, undoing manual moves. Now it sets Status only when empty.
  - `gh project link ... || true` hid failures. Now it checks the link first and shows errors.
  - Added the visibility step, `--limit` on list calls, cached field lookups, `</dev/null` on `gh` calls inside the read loop, and a printout of which built-in workflows are on. A re-run takes about one minute.

## Built-in workflows (T010): web UI only

The GraphQL API only reads workflows (`ProjectV2.workflows`) and can delete one (`deleteProjectV2Workflow`); there is no create/enable/update mutation and no REST endpoint. So these are clicks.

State after creation: only "Auto-add sub-issues to project" is on. Off: Item added to project, Item closed, Pull request linked to issue, Pull request merged, Auto-close issue.

Steps (needs org owner/project admin): open the board, click `...` (top right) > Workflows. For each workflow below click it, set the value, click Save and turn the toggle Enabled:

1. **Item added to project**: Set Status = Todo.
2. **Item closed**: Set Status = Done.
3. **Pull request merged**: Set Status = Done.
4. **Pull request linked to issue**: Set Status = In review.
5. Leave **Auto-close issue** off (issues close from `Closes #N` in the PR).
6. **Auto-add to project** (list at the bottom, "+ Add workflow"): repository `three-feathers/agent-durbar`, filter `is:issue,pr is:open` (the free plan allows one auto-add workflow), then Save and Enable. This adds new issues and PRs without running the script.

"Claimed" and "In progress" stay manual (move the card), or run the script once after claiming.

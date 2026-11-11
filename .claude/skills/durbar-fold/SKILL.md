---
name: durbar-fold
description: Make the doc-only fold PR after an Agent Durbar release tag (fragments into CHANGELOG.md, build-cost usage files and README block, README status block, landing.json, docs/build-cost.md). Use right after a release is published, or when release.yml refuses a tag because the previous release is not folded.
---

# Fold PR after a release

A checklist, not rule text. The steps in full: [changelog.d/README.md](../../../changelog.d/README.md) (*At release time*, step 3, and *A stable release*); the build cost: [docs/build-cost.md](../../../docs/build-cost.md) section 4 (spec 008 FR-181). If this file and those differ, they win: fix this file.

## Branch from the tag

1. `git fetch origin --tags`, then a new worktree on branch `008-fold-X-Y-Z` (no dots) from tag `vX.Y.Z`: `git worktree add -b 008-fold-X-Y-Z <dir> vX.Y.Z`.

## Changelog

2. The heading is in the `release.yml` run's job summary; for a stable tag: `npm run changelog:build -- --release "vX.Y.Z ([release](https://github.com/three-feathers/agent-durbar/releases/tag/vX.Y.Z), YYYY-MM-DD)"`. It writes the section and deletes the fragments.
3. Compare with the previous section (recent stable sections have no intro paragraph); `npm run changelog:check`.

## Build cost

4. `npm run usage:readme -- --release vX.Y.Z --check`. If it says the daily chart and the total differ, run `npm run usage:spread -- --write` first.
5. `npm run usage:readme -- --release vX.Y.Z --publish` (copies this machine's usage file into `docs/build-cost/data/` and rewrites the README block, `docs/build-cost.md`'s numbers, the history and the three SVGs). Read the table before it goes in (docs/build-cost.md, *What is kept*). Which local folder counts for the committed figure: docs/build-cost.md, *The committed figure*.
6. `docs/build-cost.md`: the generated *By machine or team* line lists every `docs/build-cost/data/usage-*.json` label; the line naming which label is which machine has an entry for each (add the line if missing, an entry for a new label), and *Not counted yet* (from `note` in `docs/build-cost-baseline.json`) is still true.
7. Commit the data files, `docs/build-cost-history.json`, `docs/build-cost*.svg`, `docs/build-cost-spread.json` if changed, README and `docs/build-cost.md`.

## Status lines

8. README *Status* line: the latest tag and link.
9. `docs/site/landing.json` `hero.eyebrow` and `status` (hand-written, keep them in step with the README *Status* line; `npm run test:site` only checks that the page shows what the file says).

## Finish

10. `git merge origin/main`. A modify/delete conflict on a fragment: keep the deletion (`git rm changelog.d/<file>`); new text goes in a new fragment.
11. `npm run specs:check && npm run changelog:check`, then the AGENTS.md *Before you finish* checks; labels as the previous fold PR (the PR that changed `CHANGELOG.md` last); merge as any PR ([docs/rules/merge-mechanics.md](../../../docs/rules/merge-mechanics.md), `scripts/pr-gate.sh <N>`).

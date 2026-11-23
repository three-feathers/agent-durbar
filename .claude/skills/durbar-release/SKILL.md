---
name: durbar-release
description: Cut and publish the Agent Durbar daily stable release (version PR, tag, release.yml draft, clip, publish, fold PR). Use when main has new changelog.d fragments and today's release is not out yet, or when asked to release.
---

# Daily stable release

A checklist, not rule text. The rules: spec 021 FR-064 and [docs/rules/review-rounds.md](../../../docs/rules/review-rounds.md) (*Daily release*); the steps in full: [changelog.d/README.md](../../../changelog.d/README.md) (*At release time*, *A stable release*). If this file and those differ, they win: fix this file.

Only the daily patch release needs no owner OK; any other tag does ([AGENTS.md](../../../AGENTS.md) *Needs approval*).

## Before

1. `git pull --ff-only origin main`; re-read changed rule files. `ls changelog.d/` has fragments besides `README.md`, and `gh release list --limit 3` shows no release today.
2. Next version: last tag plus one patch (`git -c versionsort.suffix=- tag --sort=-v:refname | head -1`).
3. Classify for DORA: `gh issue list --label incident --state all`; read [docs/rules/incident-triage.md](../../../docs/rules/incident-triage.md).

## Version PR

4. Branch `008-release-vX-Y-Z` (no dots) in a new worktree from `origin/main`.
5. `npm version X.Y.Z --no-git-tag-version` (only `package.json` and `package-lock.json` change), plus one row in [spec 008's Release table](../../../specs/008-packaging-and-release/spec.md#release-table).
6. PR, review, merge as any PR ([docs/rules/merge-mechanics.md](../../../docs/rules/merge-mechanics.md); `scripts/pr-gate.sh <N>` right before).

## Tag and draft

7. Optional dry run on the merge commit: `node scripts/release-notes.js --tag vX.Y.Z --repo three-feathers/agent-durbar --out ../notes.md --title-out ../title.txt`.
8. `release.yml` first waits for that commit's *UI on three OSes* run and refuses the tag unless its Linux and Windows UI jobs are green (spec 117 FR-014; macOS is not read): check it first with `gh run list --workflow ui-platforms.yml --commit <sha>`; no run listed (the merge queue pushed this commit together with a later one, as for v0.1.28): start one by hand on a branch or tag at that commit (`gh workflow run ui-platforms.yml --ref <ref>`) and tag after it is green. Never re-run a `main` push UI run (it would cancel `main`'s newest UI run, spec 117 O3). Annotated tag on that `main` commit: `git tag -a vX.Y.Z -m "vX.Y.Z" <sha> && git push origin vX.Y.Z`.
9. Wait for `release.yml` (`gh run list --workflow release.yml --limit 1`, then `gh run watch <id>`). A red run: use the `durbar-ci-rerun` skill. If only the job *UI run green on the tagged commit* failed: start a by-hand UI run on the tag (`gh workflow run ui-platforms.yml --ref vX.Y.Z`) or tag a newer green commit; once that run is green, re-run only the release run's failed jobs (`gh run rerun <release run id> --failed`; spec 021 FR-087 delta 2026-11-22).
10. Check the draft: every asset, `SHA256SUMS.txt`, the notes (`gh release view vX.Y.Z`).

## Clip (never holds a release)

11. On a checkout of the tag: `npm run release:video -- --version vX.Y.Z --out <dir>`; look at every still (spec 008 FR-176).
12. `gh release upload vX.Y.Z <dir>/release-vX.Y.Z.mp4 <dir>/release-vX.Y.Z.gif`; add the image line from `changelog.d/README.md` step 4.4 at the top of the draft notes. On any failure publish without it and say so.

## Publish and after

13. `gh release edit vX.Y.Z --draft=false --latest`; check the release page shows *Latest*.
14. Record the tag on any incident issue (step 3) and announce as FR-064 says ([docs/rules/chat-and-decisions.md](../../../docs/rules/chat-and-decisions.md) before posting).
15. Fold PR from the tag: the `durbar-fold` skill. Merge it before the next tag (`release.yml` refuses a tag while the last release is not folded).

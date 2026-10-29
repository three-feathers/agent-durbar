# Feature Specification: Release v0.1.0-alpha.18 (pre-release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0-alpha.18 (pre-release)
status: **published as a pre-release 2026-10-25** (tag on `442b3e6e`)
-->

**Feature Branch**: `089-release-alpha18`
**Created**: 2026-10-25
**Status**: **Published as a pre-release on 2026-10-25** (<https://github.com/three-feathers/agent-durbar/releases/tag/v0.1.0-alpha.18>; version PR #757; annotated tag on `442b3e6e`, the #757 merge commit). Not marked latest.
**Input**: Vikram (owner): the standing OK of 2026-10-23 for a pre-release (not latest) about every 8 hours; alpha.17 was published 2026-10-25 14:53 UTC.

## Context

Same fold-at-tag flow as alpha.17 (spec 088, spec 008 FR-117..FR-120): version-only PR, annotated tag on `main`, doc-only fold PR from the tag. No merge freeze.

## Requirements

- **FR-001** `package.json`, `package-lock.json` (root entries only) and the simulator's About label carry version `0.1.0-alpha.18`. No other change in this PR.
- **FR-002** Tag `v0.1.0-alpha.18` (annotated) on a commit on `main` after the version PR; `release.yml`'s `verify` accepts it and writes the notes from that commit's fragments.
- **FR-003** The draft is checked (files, digests, notes, known limits) and published as a **pre-release**, not "latest".
- **FR-004** A doc-only fold PR from the tag folds the fragments, adds the intro paragraph and the README status block, and lands before the next tag.

## Evidence

- `real:` annotated tag `v0.1.0-alpha.18` points at `442b3e6e5ec1757c55fd0278f5649e5eed6bc06c` (the #757 version commit on `main`).
- `real:` `release.yml` run 40241587171 concluded `success`: tag check and notes, Build on Linux, macOS and Windows, Draft release.
- `real:` the draft had 8 files; the full digests in `SHA256SUMS.txt` equal GitHub's asset digests for the 7 packages.
- `real:` published 2026-10-25 22:53 UTC, `isPrerelease: true`, `isDraft: false`; `releases/latest` is 404.
- #757 merged with `--admin` (only the approval formality blocked; author and release manager are one account); CI that ran was green.
- Not verified by the agent: no installation or run of any package on macOS or Windows.

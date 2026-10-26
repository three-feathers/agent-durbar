# Feature Specification: Release v0.1.0 (first stable release)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Release v0.1.0 (first stable release)
status: in progress (version PR)
-->

**Feature Branch**: `090-release-v010`
**Created**: 2026-10-26
**Status**: In progress.
**Input**: Vikram (owner), 2026-10-26: first stable release `v0.1.0`, unsigned and not notarized like every build; Paco agrees; feature freeze. `v0.1.0-alpha.19` was never released (its tag was deleted on 2026-10-26 after the macOS weekly-audit test failure fixed by #766, see spec 090).

## Context

Same fold-at-tag flow as the alphas (spec 008 FR-117..FR-120) plus the stable path (spec 008 FR-129, #771): a tag without `-` makes a draft that is not a pre-release; the owners publish it and mark it latest by hand. The previous published release is `v0.1.0-alpha.18` (folded in `CHANGELOG.md`), so `verify` accepts the tag.

## Requirements

- **FR-001** `package.json`, `package-lock.json` (root entries only) and the simulator's About label carry version `0.1.0`. No other change in this PR.
- **FR-002** Tag `v0.1.0` (annotated) on a commit on `main` after the version PR; `release.yml`'s `verify` accepts it (stable, not a pre-release) and writes the notes from that commit's fragments.
- **FR-003** The draft is checked (files, digests, notes, known limits), then published and marked latest: `gh release edit v0.1.0 --draft=false --latest`. Check that it shows as *Latest* (the stable path has not run on GitHub yet, spec 008 FR-129 `[KNOWN GAP]`).
- **FR-004** A doc-only fold PR from the tag (branch `NNN-fold-0-1-0`) folds the fragments with the stable heading, adds the intro paragraph and the README status block, and changes the hand-written alpha wording: `docs/site/landing.json` (`hero.eyebrow`, `status`) with the asserts in `scripts/test-site.js`. It lands before the next tag.
- **FR-005** Before tagging, classify the release for the DORA records (AGENTS.md): planned release, `No`, unless an incident says otherwise.
